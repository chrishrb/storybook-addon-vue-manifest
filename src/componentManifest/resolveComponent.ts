import { dirname } from 'node:path';

import { babelParse, types as t } from 'storybook/internal/babel';
import type { CsfFile } from 'storybook/internal/csf-tools';

import * as TsconfigPaths from 'tsconfig-paths';

import { cached, cachedReadTextFileSync, cachedResolveImport, findTsconfigPath } from './utils.ts';

/** Module resolution extensions, including `.vue` for extension-less alias imports. */
const RESOLVE_EXTENSIONS = ['.vue', '.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.cjs'];

export interface ResolvedComponentRef {
  /** Local identifier of the component in the story file (e.g. `Button`). */
  localName: string;
  /** Import source as written in the story file (e.g. `./Button.vue`). */
  importSource: string;
  /** Absolute path of the resolved component file. */
  absPath: string;
  /**
   * Export name of the component within `absPath` (e.g. `default`), set when `absPath` was reached
   * by following a barrel re-export (`export { default as X } from './X.vue'`). Lets the checker
   * be pointed at the underlying SFC export instead of the unresolvable re-export.
   */
  componentExportName?: string;
  /** Whether the import source is a resolvable bare package specifier. */
  isPackage: boolean;
  /** Whether the component is imported via a default import (the common case for SFCs). */
  isDefaultImport: boolean;
}

export type ResolveComponentResult =
  | { ref: ResolvedComponentRef; error?: undefined }
  | { ref?: undefined; error: { name: string; message: string } };

const getTsConfig = cached(
  (cwd: string) => {
    const tsconfigPath = findTsconfigPath(cwd);
    return TsconfigPaths.loadConfig(tsconfigPath);
  },
  { name: 'getTsConfig' }
);

/** Maps a tsconfig-paths alias (e.g. `@/components/Button.vue`) to a concrete path. */
function matchPath(id: string, basedir: string, tsconfigPath?: string) {
  const tsconfig = tsconfigPath ? TsconfigPaths.loadConfig(tsconfigPath) : getTsConfig(basedir);

  if (tsconfig.resultType === 'success') {
    const match = TsconfigPaths.createMatchPath(tsconfig.absoluteBaseUrl, tsconfig.paths, [
      'browser',
      'module',
      'main',
    ]);
    return match(id, undefined, undefined, RESOLVE_EXTENSIONS) ?? id;
  }
  return id;
}

/** Resolves a module specifier to an absolute path, falling back to tsconfig-paths aliases. */
function resolveModule(
  importSource: string,
  basedir: string,
  tsconfigPath?: string
): string | undefined {
  try {
    return cachedResolveImport(importSource, { basedir });
  } catch {
    // Not directly resolvable — try tsconfig paths aliases (e.g. `@/components/Button.vue`).
    try {
      const matched = matchPath(importSource, basedir, tsconfigPath);
      if (matched !== importSource) {
        return cachedResolveImport(matched, { basedir });
      }
    } catch {
      // unresolved — handled by the caller
    }
  }
  return undefined;
}

/**
 * Parses the named re-exports (`export { a as b } from './source'`) of a module into a map of
 * re-exported name -> { source module, name within that source }. `.vue` files (leaf SFCs) and
 * unparseable files yield an empty map. Direct exports without a `from` source are ignored — only
 * re-exports can be followed to another file.
 */
const parseReexports = cached(
  (filePath: string): Map<string, { source: string; sourceName: string }> => {
    const map = new Map<string, { source: string; sourceName: string }>();
    if (filePath.endsWith('.vue')) {
      return map;
    }

    let ast: ReturnType<typeof babelParse>;
    try {
      ast = babelParse(cachedReadTextFileSync(filePath));
    } catch {
      return map;
    }

    for (const stmt of ast.program.body) {
      if (!t.isExportNamedDeclaration(stmt) || !stmt.source) {
        continue;
      }
      const source = stmt.source.value;
      for (const spec of stmt.specifiers) {
        if (!t.isExportSpecifier(spec)) {
          continue;
        }
        const exported = t.isIdentifier(spec.exported) ? spec.exported.name : spec.exported.value;
        map.set(exported, { source, sourceName: spec.local.name });
      }
    }
    return map;
  },
  { name: 'parseReexports' }
);

/**
 * Follows barrel re-exports from a resolved module to the file that actually defines the component.
 * vue-component-meta cannot extract meta through a re-export such as
 * `export { default as Accordion } from './Accordion.vue'`, so when the story imports a component
 * from an `index.ts` barrel we trace the re-export (across nested barrels) down to the underlying
 * SFC and report the export name within it (e.g. `default`).
 *
 * Returns `undefined` when `startPath` is not a barrel re-export of `localName` (the common case of
 * a direct SFC import), leaving resolution unchanged.
 */
function followBarrelReexport(
  startPath: string,
  localName: string,
  tsconfigPath?: string
): { absPath: string; exportName: string } | undefined {
  let currentPath = startPath;
  let currentName = localName;
  const seen = new Set<string>();

  // Bounded loop guards against circular re-exports; depth far exceeds any real barrel chain.
  for (let depth = 0; depth < 10; depth++) {
    if (currentPath.endsWith('.vue') || seen.has(currentPath)) {
      break;
    }
    seen.add(currentPath);

    const target = parseReexports(currentPath).get(currentName);
    if (!target) {
      break;
    }
    const resolved = resolveModule(target.source, dirname(currentPath), tsconfigPath);
    if (!resolved) {
      break;
    }
    currentPath = resolved;
    currentName = target.sourceName;
  }

  return currentPath !== startPath ? { absPath: currentPath, exportName: currentName } : undefined;
}

/**
 * Finds the import source for a local identifier by scanning the story file's import declarations.
 * Fallback for cases where `CsfFile` did not populate `_rawComponentPath` (e.g. the meta object is
 * assigned through a local variable).
 */
function findImport(
  csf: CsfFile,
  localName: string
): { source: string; isDefaultImport: boolean } | undefined {
  for (const stmt of csf._ast.program.body) {
    if (!t.isImportDeclaration(stmt) || stmt.importKind === 'type') {
      continue;
    }
    const specifier = stmt.specifiers.find(
      (spec) =>
        (t.isImportDefaultSpecifier(spec) || t.isImportSpecifier(spec)) &&
        spec.local.name === localName
    );
    if (specifier) {
      return { source: stmt.source.value, isDefaultImport: t.isImportDefaultSpecifier(specifier) };
    }
  }
  return undefined;
}

/**
 * Resolves `meta.component` of a parsed CSF file to the component's source file on disk so
 * vue-component-meta can extract its metadata.
 */
export function resolveComponentRef(
  csf: CsfFile,
  absoluteStoryPath: string,
  tsconfigPath?: string
): ResolveComponentResult {
  const localName = csf._meta?.component;
  if (!localName) {
    return {
      error: {
        name: 'No component found',
        message: 'We could not detect the component from your story file. Specify meta.component.',
      },
    };
  }

  const imported = findImport(csf, localName);
  const importSource = csf._rawComponentPath ?? imported?.source;
  if (!importSource) {
    return {
      error: {
        name: 'No component import found',
        message: `No import found for the "${localName}" component in the story file.`,
      },
    };
  }
  const isDefaultImport = csf._componentImportSpecifier
    ? t.isImportDefaultSpecifier(csf._componentImportSpecifier)
    : (imported?.isDefaultImport ?? true);

  const basedir = dirname(absoluteStoryPath);
  let absPath: string | undefined;
  let isPackage = false;

  try {
    absPath = cachedResolveImport(importSource, { basedir });
    isPackage = !importSource.startsWith('.');
  } catch {
    // Not directly resolvable — try tsconfig paths aliases (e.g. `@/components/Button.vue`).
    try {
      const matched = matchPath(importSource, basedir, tsconfigPath);
      if (matched !== importSource) {
        absPath = cachedResolveImport(matched, { basedir });
      }
    } catch {
      // handled below
    }
  }

  if (!absPath) {
    return {
      error: {
        name: 'Component file not found',
        message: `Could not resolve the "${localName}" component import "${importSource}" from the story file.`,
      },
    };
  }

  // When the import resolves to a barrel/index module that re-exports the component from another
  // file, point the checker at the underlying SFC — vue-component-meta cannot extract meta through
  // a `export { default as X } from './X.vue'` re-export. The original import source is preserved
  // so the generated import statement still matches the story.
  const followed = followBarrelReexport(absPath, localName, tsconfigPath);

  return {
    ref: {
      localName,
      importSource,
      absPath: followed?.absPath ?? absPath,
      componentExportName: followed?.exportName,
      isPackage,
      isDefaultImport,
    },
  };
}
