import { storyNameFromExport } from 'storybook/internal/csf';
import {
  type CsfFile,
  extractDescription as extractCsfDescription,
  loadCsf,
} from 'storybook/internal/csf-tools';
import type {
  ComponentManifest,
  ComponentsManifest,
  IndexEntry,
  PresetPropertyFn,
  StorybookConfigRaw,
} from 'storybook/internal/types';

import path from 'pathe';
import type { ComponentMeta } from 'vue-component-meta';

import { type VueManifestAddonOptions, resolveTsconfigPath } from '../options.ts';
import {
  getComponentIdFromEntry,
  getStoryImportPathFromEntry,
  selectComponentEntriesByComponentId,
} from './entries.ts';
import { extractComponentDescription } from './extractComponentDescription.ts';
import { generateVueSnippet, mergeArgsFromAst } from './generateCodeSnippet.ts';
import { buildComponentImport, getPackageInfo } from './getComponentImports.ts';
import { type ResolvedComponentRef, resolveComponentRef } from './resolveComponent.ts';
import {
  extractComponentMeta,
  getChecker,
  refreshFileIfChanged,
} from './vueComponentMetaDocgen.ts';
import { extractJSDocInfo } from './jsdocTags.ts';
import { cachedReadTextFileSync, invalidateCache, invariant } from './utils.ts';

/** Vue-specific extension of ComponentManifest with the raw vue-component-meta data attached. */
export interface VueComponentManifest extends ComponentManifest {
  vueComponentMeta?: ComponentMeta;
  [key: string]: unknown;
}

/** Extract stories from a parsed CSF file, generating Vue template snippets. */
function extractStories(
  csf: CsfFile,
  componentMeta: ComponentMeta | undefined,
  tagName: string,
  manifestEntryIds: ReadonlySet<string>
) {
  return Object.entries(csf._stories)
    .filter(([, story]) =>
      // Only include stories that are in the list of entries already filtered for the 'manifest' tag
      manifestEntryIds.has(story.id)
    )
    .map(([storyExport, story]) => {
      const name = story.name ?? storyNameFromExport(storyExport);
      try {
        const jsdocComment = extractCsfDescription(csf._storyStatements[storyExport]);
        const { tags = {}, description } = jsdocComment ? extractJSDocInfo(jsdocComment) : {};
        const finalDescription = (tags?.describe?.[0] || tags?.desc?.[0]) ?? description;

        // Merge meta + story args from the AST and generate the Vue template snippet
        const args = mergeArgsFromAst(csf._metaNode, csf._storyAnnotations[storyExport]);
        const snippet = generateVueSnippet(
          Object.keys(args).length > 0 ? args : undefined,
          componentMeta,
          tagName
        );

        return {
          id: story.id,
          name,
          snippet,
          description: finalDescription?.trim(),
          summary: tags.summary?.[0],
        };
      } catch (e) {
        invariant(e instanceof Error);
        return {
          id: story.id,
          name,
          error: { name: e.name, message: e.message },
        };
      }
    });
}

/**
 * Main manifest generator for Vue (vite).
 *
 * Implements the `experimental_manifests` preset property. Uses vue-component-meta (Volar) to
 * extract component metadata server-side, then iterates over manifest-tagged IndexEntries to build
 * ComponentManifest objects.
 */
export const manifests: PresetPropertyFn<
  'experimental_manifests',
  StorybookConfigRaw,
  { manifestEntries: IndexEntry[]; watch?: boolean }
> = async (existingManifests = {}, options) => {
  const { manifestEntries, presets, watch } = options;

  // Invalidate file caches between runs (the vue-component-meta checker is intentionally kept).
  invalidateCache();

  const startTime = performance.now();

  // The manifest is generated server-side with vue-component-meta regardless of which runtime
  // docgen plugin is configured; the tsconfig comes from the addon options or the vue3-vite
  // framework `docgen.tsconfig` option.
  const framework = await presets?.apply('framework');
  const tsconfigPath = resolveTsconfigPath(options as VueManifestAddonOptions, framework);

  const checker = await getChecker(tsconfigPath);

  const manifestEntryIds = new Set(manifestEntries.map((entry) => entry.id));
  const entriesByUniqueComponent = [
    ...selectComponentEntriesByComponentId(manifestEntries).values(),
  ];

  const components = await Promise.all(
    entriesByUniqueComponent.map(async (entry): Promise<VueComponentManifest> => {
      const id = getComponentIdFromEntry(entry);
      const title = entry.title.split('/').at(-1)?.replaceAll(/\s+/g, '') ?? '';

      try {
        const storyFilePath = getStoryImportPathFromEntry(entry);
        invariant(storyFilePath, `No story file path for index entry ${entry.id}`);

        const absoluteStoryPath = path.join(process.cwd(), storyFilePath);
        const storyFile = cachedReadTextFileSync(absoluteStoryPath);
        const csf = loadCsf(storyFile, { makeTitle: () => entry.title }).parse();

        const componentName = csf._meta?.component;

        const resolved = resolveComponentRef(csf, absoluteStoryPath, tsconfigPath);
        const ref: ResolvedComponentRef | undefined = resolved.ref;

        let componentMeta: ComponentMeta | undefined;
        let extractionError: { name: string; message: string } | undefined;
        if (ref) {
          try {
            if (watch) {
              refreshFileIfChanged(checker, ref.absPath);
            }
            componentMeta = (await extractComponentMeta(checker, ref.absPath, ref.localName))?.meta;
          } catch (e) {
            // The checker throws e.g. when the component file is not part of its TypeScript
            // program. Degrade to an error entry that still carries stories and import.
            extractionError = {
              name: 'vue-component-meta error',
              message: e instanceof Error ? e.message : String(e),
            };
          }
        }

        const tagName = ref?.localName ?? componentName ?? title;
        const stories = extractStories(csf, componentMeta, tagName, manifestEntryIds);

        // Extract component-level description from the CSF meta JSDoc
        const metaJsDoc = extractCsfDescription(csf._metaStatement) || undefined;
        const { description, summary, jsDocTags } = extractComponentDescription(
          metaJsDoc,
          undefined
        );

        const storyPackageName = getPackageInfo(undefined, absoluteStoryPath);
        const componentPackageName = ref
          ? getPackageInfo(ref.absPath, absoluteStoryPath)
          : undefined;
        const importStatement = ref
          ? buildComponentImport(ref, storyPackageName, componentPackageName, jsDocTags.import?.[0])
          : undefined;

        const base: VueComponentManifest = {
          id,
          name: componentName ?? title,
          path: storyFilePath,
          stories,
          import: importStatement,
          description,
          summary,
          jsDocTags,
          vueComponentMeta: componentMeta,
        };

        if (resolved.error) {
          return { ...base, error: resolved.error };
        }

        if (!componentMeta) {
          return {
            ...base,
            error: extractionError ?? {
              name: 'No component meta found',
              message: `vue-component-meta could not extract metadata for the "${tagName}" component (${ref?.absPath}).`,
            },
          };
        }

        return base;
      } catch (e) {
        return {
          id,
          name: title,
          path: entry.importPath,
          stories: [],
          jsDocTags: {},
          error: {
            name: e instanceof Error ? e.name : 'Unknown error',
            message: e instanceof Error ? e.message : String(e),
          },
        };
      }
    })
  );

  const durationMs = Math.round(performance.now() - startTime);

  return {
    ...existingManifests,
    components: {
      v: 0,
      components: Object.fromEntries(components.map((component) => [component.id, component])),
      meta: {
        // 'vue-component-meta' is not yet part of the docgen union published in storybook's
        // ComponentsManifest type — drop the cast once it is.
        docgen: 'vue-component-meta' as unknown as NonNullable<
          ComponentsManifest['meta']
        >['docgen'],
        durationMs,
      },
    },
  };
};
