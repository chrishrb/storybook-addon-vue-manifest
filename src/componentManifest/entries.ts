/**
 * Story-index entry helpers and tag constants, vendored from Storybook core
 * (`code/core/src/common/utils/select-component-entry.ts` and
 * `code/core/src/shared/constants/tags.ts`) so the addon does not depend on very recent
 * `storybook/internal/common` exports.
 */
import type { DocsIndexEntry, IndexEntry } from 'storybook/internal/types';

export const Tag = {
  ATTACHED_MDX: 'attached-mdx',
  AUTODOCS: 'autodocs',
  DEV: 'dev',
  MANIFEST: 'manifest',
  TEST: 'test',
} as const;

/**
 * Derives the componentId portion of a story index entry id. Storybook story ids have the shape
 * `<componentId>--<storyName>`.
 */
export function getComponentIdFromEntry(entry: Pick<IndexEntry, 'id'>): string {
  return entry.id.split('--')[0];
}

function isAttachedDocsEntry(
  entry: IndexEntry
): entry is DocsIndexEntry & { storiesImports: [string, ...string[]] } {
  return (
    entry.type === 'docs' &&
    entry.tags?.includes(Tag.ATTACHED_MDX) === true &&
    entry.storiesImports.length > 0
  );
}

function isEligibleStoryEntry(entry: IndexEntry): boolean {
  return entry.type === 'story' && entry.subtype === 'story';
}

/**
 * CSF story file path used for component resolution — the story entry's `importPath`, or the first
 * `storiesImports` entry for attached MDX docs.
 */
export function getStoryImportPathFromEntry(entry: IndexEntry): string | undefined {
  if (entry.type === 'story') {
    return entry.importPath;
  }
  if (isAttachedDocsEntry(entry)) {
    return entry.storiesImports[0];
  }
  return undefined;
}

/**
 * Picks one index entry per componentId: story entries win; attached docs fill gaps only where no
 * story exists for that componentId.
 */
export function selectComponentEntriesByComponentId(
  indexEntries: IndexEntry[]
): Map<string, IndexEntry> {
  const entriesByComponentId = new Map<string, IndexEntry>();

  for (const entry of indexEntries) {
    if (!isEligibleStoryEntry(entry)) {
      continue;
    }
    entriesByComponentId.set(getComponentIdFromEntry(entry), entry);
  }

  for (const entry of indexEntries) {
    if (!isAttachedDocsEntry(entry)) {
      continue;
    }
    const componentId = getComponentIdFromEntry(entry);
    if (!entriesByComponentId.has(componentId)) {
      entriesByComponentId.set(componentId, entry);
    }
  }

  return entriesByComponentId;
}
