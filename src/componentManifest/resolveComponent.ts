import { dirname } from 'node:path';

import { types as t } from 'storybook/internal/babel';
import type { CsfFile } from 'storybook/internal/csf-tools';

import * as TsconfigPaths from 'tsconfig-paths';

import { cached, cachedResolveImport, findTsconfigPath } from './utils.ts';

/** Module resolution extensions, including `.vue` for extension-less alias imports. */
const RESOLVE_EXTENSIONS = ['.vue', '.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.cjs'];

export interface ResolvedComponentRef {
  /** Local identifier of the component in the story file (e.g. `Button`). */
  localName: string;
  /** Import source as written in the story file (e.g. `./Button.vue`). */
  importSource: string;
  /** Absolute path of the resolved component file. */
  absPath: string;
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

  return { ref: { localName, importSource, absPath, isPackage, isDefaultImport } };
}
