import { readFile, stat } from 'node:fs/promises';
import { join, parse } from 'node:path';

import { getProjectRoot } from 'storybook/internal/common';

import {
  type ComponentMeta,
  type MetaCheckerOptions,
  createChecker,
  createCheckerByJson,
} from 'vue-component-meta';
import { parseMulti } from 'vue-docgen-api';
import type * as ts from 'typescript';

export type VueComponentMetaChecker = ReturnType<typeof createCheckerByJson>;

/**
 * `schema.ignore` predicate that leaves any type declared in `node_modules` unexpanded (kept as an
 * opaque type string instead of a nested schema). This mirrors the default `propFilter` Storybook
 * applies to react-docgen-typescript (`!/node_modules/.test(parent.fileName)`): it stops large or
 * self-referential DOM/library types (`MouseEvent`, `HTMLElement`, …) from exploding the manifest
 * while the project's own types are still fully resolved.
 *
 * Returns `undefined` (not `false`) for project-owned types so vue-component-meta keeps evaluating
 * its remaining ignore rules — returning `false` would force-include the type and short-circuit.
 */
export function ignoreNodeModuleTypes(_name: string, type: ts.Type): boolean | undefined {
  const declaration =
    type.getSymbol()?.declarations?.[0] ?? type.aliasSymbol?.declarations?.[0];
  const fileName = declaration?.getSourceFile().fileName;
  return fileName?.includes('node_modules') ? true : undefined;
}

/**
 * Creates the `vue-component-meta` checker to use for extracting component meta/docs. Considers the
 * given tsconfig file (will use a fallback checker if it does not exist or is not supported).
 */
export async function createVueComponentMetaChecker(tsconfigPath = 'tsconfig.json') {
  const checkerOptions: MetaCheckerOptions = {
    forceUseTs: true,
    noDeclarations: true,
    printer: { newLine: 1 },
    // Resolve complex prop/event/slot/exposed types into structured schemas (unions, arrays,
    // objects, callbacks) rather than flat type strings — without it vue-component-meta returns the
    // bare type name for every type. node_modules types are kept opaque to bound the manifest size.
    schema: { ignore: [ignoreNodeModuleTypes] },
  };

  const projectRoot = getProjectRoot();

  const projectTsConfigPath = join(projectRoot, tsconfigPath);

  const defaultChecker = createCheckerByJson(projectRoot, { include: ['**/*'] }, checkerOptions);

  // prefer the tsconfig.json file of the project to support alias resolution etc.
  if (await fileExists(projectTsConfigPath)) {
    // vue-component-meta does currently not resolve tsconfig references (see https://github.com/vuejs/language-tools/issues/3896)
    // so we will return the defaultChecker if references are used.
    // Otherwise vue-component-meta might not work at all for the Storybook docgen.
    const references = await getTsConfigReferences(projectTsConfigPath);

    if (references.length > 0) {
      return defaultChecker;
    }
    return createChecker(projectTsConfigPath, checkerOptions);
  }

  return defaultChecker;
}

/** Gets the filename without file extension. */
export function getFilenameWithoutExtension(filename: string) {
  return parse(filename).name;
}

/** Lowercases the first letter. */
export function lowercaseFirstLetter(string: string) {
  return string.charAt(0).toLowerCase() + string.slice(1);
}

/** Checks whether the given file path exists. */
async function fileExists(fullPath: string) {
  try {
    await stat(fullPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Applies a temporary workaround/fix for missing event descriptions because Volar is currently not
 * able to extract them. Will modify the events of the passed meta. Performance note: Based on some
 * quick tests, calling "parseMulti" only takes a few milliseconds (8-20ms) so it should not
 * decrease performance that much. Especially because it is only execute if the component actually
 * has events.
 *
 * Check status of this Volar issue: https://github.com/vuejs/language-tools/issues/3893 and
 * update/remove this workaround once Volar supports it:
 *
 * - Delete this function
 * - Uninstall vue-docgen-api dependency
 */
export async function applyTempFixForEventDescriptions(
  filename: string,
  componentMeta: ComponentMeta[]
) {
  // do not apply temp fix if no events exist for performance reasons
  const hasEvents = componentMeta.some((meta) => meta.events.length);

  if (!hasEvents) {
    return componentMeta;
  }

  try {
    const parsedComponentDocs = await parseMulti(filename);

    // add event descriptions to the existing Volar meta if available
    componentMeta.map((meta, index) => {
      const eventsWithDescription = parsedComponentDocs[index].events;

      if (!meta.events.length || !eventsWithDescription?.length) {
        return meta;
      }

      meta.events = meta.events.map((event) => {
        const description = eventsWithDescription.find((i) => i.name === event.name)?.description;
        if (description) {
          (event as typeof event & { description: string }).description = description;
        }
        return event;
      });

      return meta;
    });
  } catch {
    // noop
  }

  return componentMeta;
}

/**
 * Gets a list of tsconfig references for the given tsconfig This is only needed for the temporary
 * workaround/fix for: https://github.com/vuejs/language-tools/issues/3896
 */
async function getTsConfigReferences(tsConfigPath: string) {
  try {
    const content = JSON.parse(await readFile(tsConfigPath, 'utf-8'));

    if (!('references' in content) || !Array.isArray(content.references)) {
      return [];
    }
    return content.references as unknown[];
  } catch {
    // invalid project tsconfig
    return [];
  }
}
