import { beforeEach, expect, test, vi } from 'vitest';

import { Tag } from './entries.ts';

import { componentMetaByPath, indexJson } from './fixtures.ts';
import { manifests } from './generator.ts';
import { setupMemfsMocks } from './memfs-test-setup.ts';
import { extractComponentMeta, getChecker } from './vueComponentMetaDocgen.ts';

// Opt into memfs for this file (loads from __mocks__/fs.cjs)
vi.mock('node:fs');
vi.mock('node:fs/promises');

vi.mock(import('./utils.ts'), { spy: true });
vi.mock('empathic/find', { spy: true });
vi.mock('tsconfig-paths', { spy: true });
// The real Volar checker builds a TypeScript program through the externalized `typescript`
// package, which bypasses memfs — so the docgen module is mocked with fixture meta.
vi.mock(import('./vueComponentMetaDocgen.ts'));

/** Call manifests with only the fields tests need (presets/watch are optional-chained at runtime). */
type ManifestOptions = Parameters<typeof manifests>[1];
type ManifestEntries = ManifestOptions['manifestEntries'];
const createManifestOptions = (
  manifestEntries: ManifestEntries,
  options: Partial<ManifestOptions> = {}
): ManifestOptions => ({ watch: false, manifestEntries, ...options }) as ManifestOptions;

const runManifests = (
  manifestEntries: ManifestEntries,
  existingManifests?: Parameters<typeof manifests>[0]
) => manifests(existingManifests, createManifestOptions(manifestEntries));

const manifestEntries = Object.values(indexJson.entries).filter(
  (entry) => entry.tags?.includes(Tag.MANIFEST) ?? false
);

beforeEach(() => {
  setupMemfsMocks();

  vi.mocked(getChecker).mockResolvedValue({} as Awaited<ReturnType<typeof getChecker>>);
  vi.mocked(extractComponentMeta).mockImplementation(async (checker, absPath) => {
    const meta = componentMetaByPath[absPath];
    return meta ? { meta, displayName: 'Button', exportName: 'default' } : undefined;
  });
});

test('generates component manifest with snippets, import and description', async () => {
  const result = await runManifests(manifestEntries);

  const button = result?.components?.components['example-button'];
  expect(button).toMatchInlineSnapshot(`
    {
      "description": "Primary UI component for user interaction",
      "id": "example-button",
      "import": "import Button from './Button.vue';",
      "jsDocTags": {
        "summary": [
          "A simple button",
        ],
      },
      "name": "Button",
      "path": "./src/stories/Button.stories.ts",
      "stories": [
        {
          "description": "The primary variant of the button",
          "id": "example-button--primary",
          "name": "Primary",
          "snippet": "<Button @click="onClick" primary label="Button" />",
          "summary": undefined,
        },
        {
          "description": undefined,
          "id": "example-button--secondary",
          "name": "Secondary",
          "snippet": "<Button @click="onClick" label="Button">Click me</Button>",
          "summary": undefined,
        },
        {
          "description": undefined,
          "id": "example-button--with-count",
          "name": "With Count",
          "snippet": "<Button @click="onClick" label="Button" :count="3" />",
          "summary": undefined,
        },
      ],
      "summary": "A simple button",
      "vueComponentMeta": {
        "events": [
          {
            "name": "click",
          },
        ],
        "exposed": [],
        "props": [
          {
            "name": "label",
          },
          {
            "name": "primary",
          },
          {
            "name": "count",
          },
        ],
        "slots": [
          {
            "name": "default",
          },
        ],
        "type": 1,
      },
    }
  `);
});

test('sets the docgen engine and duration in the manifest meta', async () => {
  const result = await runManifests(manifestEntries);
  expect(result?.components?.meta?.docgen).toBe('vue-component-meta');
  expect(result?.components?.meta?.durationMs).toEqual(expect.any(Number));
});

test('excludes stories without the manifest tag', async () => {
  const result = await runManifests(manifestEntries);
  const storyIds = result?.components?.components['example-button']?.stories.map((s) => s.id);
  expect(storyIds).not.toContain('example-button--hidden');
});

test('resolves attached MDX docs entries via storiesImports', async () => {
  const docsOnlyEntries = [indexJson.entries['example-header--docs']];
  const result = await runManifests(docsOnlyEntries);

  const header = result?.components?.components['example-header'];
  expect(header?.name).toBe('Header');
  expect(header?.path).toBe('./src/stories/Header.stories.ts');
  expect(header?.error).toBeUndefined();
});

test('prefers story entries over attached MDX docs entries for the same component', async () => {
  const result = await runManifests(manifestEntries);
  const header = result?.components?.components['example-header'];
  // The story entry and the docs entry share the component id — only one manifest entry exists
  expect(header).toBeDefined();
  expect(
    Object.keys(result?.components?.components ?? {}).filter((id) => id === 'example-header')
  ).toHaveLength(1);
  // Object args are serialized into the snippet
  expect(header?.stories[0]?.snippet).toBe(`<Header :user="{name: 'Jane Doe'}" />`);
});

test('emits an error entry when meta.component is missing', async () => {
  const result = await runManifests(manifestEntries);
  const noComponent = result?.components?.components['example-nocomponent'];
  expect(noComponent?.error).toEqual({
    name: 'No component found',
    message: 'We could not detect the component from your story file. Specify meta.component.',
  });
});

test('emits an error entry when vue-component-meta finds no metadata', async () => {
  vi.mocked(extractComponentMeta).mockResolvedValue(undefined);
  const result = await runManifests([indexJson.entries['example-button--primary']]);
  const button = result?.components?.components['example-button'];
  expect(button?.error?.name).toBe('No component meta found');
  // best-effort stories/snippets are still generated
  expect(button?.stories).toHaveLength(1);
});

test('merges existing manifests', async () => {
  const result = await runManifests(manifestEntries, { other: { v: 0 } });
  expect(result?.other).toEqual({ v: 0 });
  expect(result?.components).toBeDefined();
});
