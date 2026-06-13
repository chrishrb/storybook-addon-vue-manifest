import { readFileSync, statSync } from 'node:fs';

import type { ComponentMeta } from 'vue-component-meta';
import { type ComponentDoc, parseMulti } from 'vue-docgen-api';

import {
  type VueComponentMetaChecker,
  createVueComponentMetaChecker,
  getFilenameWithoutExtension,
  removeAllNestedSchemas,
} from '../vueComponentMetaUtils.ts';

/**
 * Long-lived checker instances keyed by tsconfig path. Creating a checker builds a full TypeScript
 * program (expensive, seconds on large projects), while the manifest preset hook runs on every
 * `/manifests/*` request in dev — so checkers are reused across runs and only individual files are
 * refreshed via {@link refreshFileIfChanged}.
 */
let checkers = new Map<string, Promise<VueComponentMetaChecker>>();

/** Last-seen modification time per component file, used to refresh the checker in watch mode. */
let fileMtimes = new Map<string, number>();

export function getChecker(tsconfigPath = 'tsconfig.json'): Promise<VueComponentMetaChecker> {
  let checker = checkers.get(tsconfigPath);
  if (!checker) {
    checker = createVueComponentMetaChecker(tsconfigPath);
    checkers.set(tsconfigPath, checker);
  }
  return checker;
}

/**
 * Updates the checker with the current file content when the file changed on disk since the last
 * run. Only refreshes the component file itself — type changes in transitively imported files are
 * picked up once the component file changes (same granularity as the vite docgen plugin's
 * `handleHotUpdate`).
 */
export function refreshFileIfChanged(checker: VueComponentMetaChecker, absPath: string) {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(absPath).mtimeMs;
  } catch {
    return;
  }

  const lastSeen = fileMtimes.get(absPath);
  if (lastSeen !== mtimeMs) {
    fileMtimes.set(absPath, mtimeMs);
    if (lastSeen !== undefined) {
      checker.updateFile(absPath, readFileSync(absPath, 'utf-8'));
    }
  }
}

/** Reset all checker and mtime state. Only intended for tests. */
export function invalidateDocgenCache() {
  checkers = new Map();
  fileMtimes = new Map();
}

export interface ExtractedComponentMeta {
  meta: ComponentMeta;
  displayName: string;
  exportName: string;
  /**
   * Component-level JSDoc description. Volar extracts it natively for `.ts`/`.js` components
   * (vuejs/language-tools#5797); for `.vue` SFCs it falls back to vue-docgen-api, which reads the
   * JSDoc above `defineOptions({...})` (script setup) or above `export default` (Options API),
   * then to the `<docs>` block.
   */
  description?: string;
  /** Component-level JSDoc tags (e.g. `@summary`), flattened to plain strings. */
  jsDocTags?: Record<string, string[]>;
}

/**
 * Parses the component file with vue-docgen-api. Supplements what Volar cannot extract yet:
 * component-level descriptions/tags for SFCs and event descriptions
 * (https://github.com/vuejs/language-tools/issues/3893).
 */
async function parseComponentDocs(absPath: string): Promise<ComponentDoc[] | undefined> {
  try {
    return await parseMulti(absPath);
  } catch {
    return undefined;
  }
}

/** Flattens vue-docgen-api tags ({title, description|content} entries) into plain strings. */
function flattenDocgenTags(tags: NonNullable<ComponentDoc['tags']>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(tags).map(([title, entries]) => [
      title,
      entries.map((entry) =>
        String('description' in entry ? entry.description : (entry.content ?? ''))
      ),
    ])
  );
}

/**
 * Extracts the vue-component-meta data for a component file. Prefers the default export (the
 * common case for SFCs) and falls back to a named export matching the local import name from the
 * story file.
 */
export async function extractComponentMeta(
  checker: VueComponentMetaChecker,
  absPath: string,
  localName?: string,
  preferredExportName?: string
): Promise<ExtractedComponentMeta | undefined> {
  const exportNames = checker.getExportNames(absPath);
  // When the component was resolved through a barrel re-export, `preferredExportName` names the
  // exact export within `absPath` (e.g. `default` for `export { default as X } from './X.vue'`)
  // and takes precedence over the default-export heuristic.
  const exportName =
    (preferredExportName && exportNames.includes(preferredExportName)
      ? preferredExportName
      : undefined) ??
    (exportNames.includes('default')
      ? 'default'
      : exportNames.find((name) => name === localName));

  if (!exportName) {
    return undefined;
  }

  const raw = checker.getComponentMeta(absPath, exportName);
  // ComponentMeta exposes its collections via getter-only properties — materialize a plain copy
  // so it can be modified and serialized. Global props (key, ref, class, style, ...) apply to
  // every component and would only add noise to the manifest.
  const meta: ComponentMeta = {
    name: raw.name,
    description: raw.description,
    type: raw.type,
    props: raw.props.filter((prop) => !prop.global),
    events: raw.events,
    slots: raw.slots,
    exposed: raw.exposed,
  };

  const componentDocs = await parseComponentDocs(absPath);
  const doc =
    componentDocs?.find((componentDoc) => componentDoc.exportName === exportName) ??
    componentDocs?.[0];

  // Merge event descriptions from vue-docgen-api into the Volar meta (Volar cannot extract them)
  if (doc?.events?.length && meta.events.length) {
    meta.events = meta.events.map((event) => {
      const description = doc.events?.find((i) => i.name === event.name)?.description;
      return description ? { ...event, description } : event;
    });
  }

  // Nested schemas are unused by the manifest and can be enormous (e.g. HTMLElement) or circular,
  // so they are stripped before the meta is serialized into the manifest JSON.
  removeAllNestedSchemas(meta);

  const description =
    meta.description?.trim() ||
    doc?.description?.trim() ||
    doc?.docsBlocks
      ?.map((block) => block.trim())
      .join('\n\n')
      .trim() ||
    undefined;
  const jsDocTags =
    doc?.tags && Object.keys(doc.tags).length > 0 ? flattenDocgenTags(doc.tags) : undefined;

  return {
    meta,
    displayName:
      meta.name ??
      (exportName === 'default' ? getFilenameWithoutExtension(absPath) : exportName),
    exportName,
    description,
    jsDocTags,
  };
}
