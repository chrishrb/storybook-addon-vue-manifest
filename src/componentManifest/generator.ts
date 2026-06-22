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
import {
  extractRenderTemplate,
  extractStorySource,
  generateVueSnippet,
  mergeArgsFromAst,
} from './generateCodeSnippet.ts';
import { buildComponentImport, getPackageInfo } from './getComponentImports.ts';
import {
  type ResolvedComponentRef,
  resolveComponentRef,
  resolveLocalIdentifier,
} from './resolveComponent.ts';
import {
  collectReferences,
  collectStoryImports,
  storyReferenceNodes,
} from './referencedSymbols.ts';
import {
  extractComponentMeta,
  getChecker,
  refreshFileIfChanged,
} from './vueComponentMetaDocgen.ts';
import { extractJSDocInfo } from './jsdocTags.ts';
import { cachedReadTextFileSync, invalidateCache, invariant } from './utils.ts';

/** A manifest story entry as captured by this addon. */
export type VueStory = NonNullable<ComponentManifest['stories']>[number];

/** Vue-specific extension of ComponentManifest with the raw vue-component-meta data attached. */
export interface VueComponentManifest extends Omit<ComponentManifest, 'stories'> {
  stories: VueStory[];
  vueComponentMeta?: ComponentMeta;
  /**
   * Component ids of the documented components whose stories reference this one. Present only on
   * entries synthesized for sub-components that have no story of their own (see
   * {@link buildReferencedComponents}), so MCP consumers can tell them apart from story-backed
   * components and trace where they are used.
   */
  referencedBy?: string[];
  [key: string]: unknown;
}

/** Lower-cased, hyphen-separated id derived from a component display name (e.g. `DataTableHeaderCell` → `data-table-header-cell`). */
function kebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

/**
 * Imported component identifiers a story file references (in a `components: {}` map or via `h(...)`)
 * other than its own `meta.component`. Restricted to imported names so each can be resolved to a
 * file — locally-defined inline components are skipped.
 */
function collectReferencedComponentNames(
  csf: CsfFile,
  primaryLocalName: string | undefined
): string[] {
  const importedNames = new Set(collectStoryImports(csf).map((imp) => imp.localName));
  const { componentNames } = collectReferences(storyReferenceNodes(csf));
  return [...componentNames].filter(
    (name) => name !== primaryLocalName && importedNames.has(name)
  );
}

/** A sub-component referenced by a story, pending resolution and meta extraction. */
interface ReferencedCandidate {
  csf: CsfFile;
  absoluteStoryPath: string;
  localName: string;
  /** Component id of the documented component whose story references it. */
  componentId: string;
}

/**
 * Resolves and documents the sub-components referenced by stories but lacking a story of their own
 * (e.g. cell renderers used inside a table's column definitions). Each unique component file is
 * resolved once, run through vue-component-meta, and emitted as a manifest entry tagged with the
 * {@link VueComponentManifest.referencedBy} ids of the stories that use it. Components that already
 * have a story-backed entry (matched by resolved file path) are skipped.
 */
async function buildReferencedComponents(
  candidates: ReferencedCandidate[],
  primaryAbsPaths: ReadonlySet<string>,
  existingIds: ReadonlySet<string>,
  checker: Awaited<ReturnType<typeof getChecker>>,
  tsconfigPath: string,
  watch: boolean | undefined
): Promise<VueComponentManifest[]> {
  // Dedupe candidates by resolved file (+ export) so a component referenced from many stories is
  // documented once, accumulating every referencing component id.
  const byResolved = new Map<
    string,
    { ref: ResolvedComponentRef; referencedBy: Set<string>; absoluteStoryPath: string }
  >();

  for (const candidate of candidates) {
    const { ref } = resolveLocalIdentifier(
      candidate.csf,
      candidate.localName,
      candidate.absoluteStoryPath,
      tsconfigPath
    );
    // Unresolvable references and components already documented via their own story are skipped.
    if (!ref || primaryAbsPaths.has(ref.absPath)) {
      continue;
    }
    const key = `${ref.absPath}::${ref.componentExportName ?? ''}`;
    const existing = byResolved.get(key);
    if (existing) {
      existing.referencedBy.add(candidate.componentId);
    } else {
      byResolved.set(key, {
        ref,
        referencedBy: new Set([candidate.componentId]),
        absoluteStoryPath: candidate.absoluteStoryPath,
      });
    }
  }

  const usedIds = new Set(existingIds);
  const entries: VueComponentManifest[] = [];

  for (const { ref, referencedBy, absoluteStoryPath } of byResolved.values()) {
    let extracted: Awaited<ReturnType<typeof extractComponentMeta>>;
    try {
      if (watch) {
        refreshFileIfChanged(checker, ref.absPath);
      }
      extracted = await extractComponentMeta(
        checker,
        ref.absPath,
        ref.localName,
        ref.componentExportName
      );
    } catch {
      // The checker throws when the file is outside its program — skip rather than emit a noise
      // entry, the component is still visible in the referencing story's `source`.
      continue;
    }
    if (!extracted) {
      continue;
    }

    const id = kebabCase(extracted.displayName || ref.localName);
    // A story-backed component (or an earlier referenced one) already owns this id — don't clobber.
    if (usedIds.has(id)) {
      continue;
    }
    usedIds.add(id);

    const storyPackageName = getPackageInfo(undefined, absoluteStoryPath);
    const componentPackageName = getPackageInfo(ref.absPath, absoluteStoryPath);

    entries.push({
      id,
      name: extracted.displayName || ref.localName,
      // The component's own source file (no story of its own), relative to the project root.
      path: path.relative(process.cwd(), ref.absPath),
      stories: [],
      import: buildComponentImport(ref, storyPackageName, componentPackageName, undefined),
      description: extracted.description,
      summary: extracted.jsDocTags?.summary?.[0],
      jsDocTags: extracted.jsDocTags ?? {},
      referencedBy: [...referencedBy].sort(),
      vueComponentMeta: extracted.meta,
    });
  }

  return entries;
}

/** Extract stories from a parsed CSF file, generating Vue template snippets. */
function extractStories(
  csf: CsfFile,
  componentMeta: ComponentMeta | undefined,
  tagName: string,
  manifestEntryIds: ReadonlySet<string>
) {
  // Story/meta export names are skipped when inlining module declarations into a story's source —
  // a render referencing another story export is not a definition worth inlining.
  const storyExportNames: ReadonlySet<string> = new Set([
    ...Object.keys(csf._stories),
    'default',
    'meta',
  ]);

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

        // A story-level `render` with a literal template is what actually renders, so prefer it
        // over args-based generation. Falls back to args when the render has no extractable
        // template (e.g. it only spreads `v-bind="args"`).
        const renderNode = csf._storyAnnotations[storyExport]?.render;
        const renderTemplate = extractRenderTemplate(renderNode);

        // Merge meta + story args from the AST and generate the Vue template snippet
        const args = mergeArgsFromAst(csf._metaNode, csf._storyAnnotations[storyExport]);
        const generatedSnippet =
          renderTemplate ??
          generateVueSnippet(
            Object.keys(args).length > 0 ? args : undefined,
            componentMeta,
            tagName
          );

        // Prefer the verbatim render source (incl. setup/columns definitions) for render-based
        // stories — the generated snippet only carries the template, which can reference opaque
        // locals like `columns`. Fall back to the generated snippet when there is no render source.
        const source = extractStorySource(renderNode, csf._ast.program.body, storyExportNames);

        return {
          id: story.id,
          name,
          snippet: source ?? generatedSnippet,
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

  // Sub-components referenced by stories (and the resolved paths of the story-backed components, so
  // referenced ones that turn out to have their own story are not duplicated) are gathered during
  // the primary pass and documented afterwards by buildReferencedComponents.
  const referencedCandidates: ReferencedCandidate[] = [];
  const primaryAbsPaths = new Set<string>();

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

        if (ref) {
          primaryAbsPaths.add(ref.absPath);
        }
        for (const localName of collectReferencedComponentNames(csf, ref?.localName)) {
          referencedCandidates.push({ csf, absoluteStoryPath, localName, componentId: id });
        }

        let componentMeta: ComponentMeta | undefined;
        let extractionError: { name: string; message: string } | undefined;
        if (ref) {
          try {
            if (watch) {
              refreshFileIfChanged(checker, ref.absPath);
            }
            componentMeta = (
              await extractComponentMeta(
                checker,
                ref.absPath,
                ref.localName,
                ref.componentExportName
              )
            )?.meta;
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

  // Document referenced sub-components (no story of their own) once all primary components — and
  // their resolved paths/ids — are known.
  const referencedComponents = await buildReferencedComponents(
    referencedCandidates,
    primaryAbsPaths,
    new Set(components.map((component) => component.id)),
    checker,
    tsconfigPath,
    watch
  );

  const durationMs = Math.round(performance.now() - startTime);

  return {
    ...existingManifests,
    components: {
      v: 0,
      components: Object.fromEntries(
        [...components, ...referencedComponents].map((component) => [component.id, component])
      ),
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
