import { beforeEach, expect, test, vi } from 'vitest';

import { Tag } from './entries.ts';

import { componentMetaByPath, indexJson } from './fixtures.ts';
import { type VueComponentManifest, manifests } from './generator.ts';
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

/** Look up a component as its Vue-extended manifest shape (vueComponentMeta, referencedBy, …). */
const componentOf = (
  result: Awaited<ReturnType<typeof manifests>>,
  id: string
): VueComponentManifest | undefined =>
  result?.components?.components[id] as VueComponentManifest | undefined;

beforeEach(() => {
  setupMemfsMocks();

  vi.mocked(getChecker).mockResolvedValue({} as Awaited<ReturnType<typeof getChecker>>);
  vi.mocked(extractComponentMeta).mockImplementation(async (checker, absPath) => {
    const meta = componentMetaByPath[absPath];
    // Derive the display name from the file name so referenced sub-components get a sensible id.
    const displayName = absPath.split('/').at(-1)?.replace(/\.\w+$/, '') ?? 'Component';
    return meta ? { meta, displayName, exportName: 'default' } : undefined;
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
      "reactComponentMeta": {
        "props": {
          "count": {
            "defaultValue": undefined,
            "description": undefined,
            "required": false,
            "type": {
              "name": "number | undefined",
              "raw": "undefined | number",
            },
          },
          "icon": {
            "defaultValue": undefined,
            "description": "Optional leading icon",
            "required": false,
            "type": {
              "name": "IconConfig | undefined",
              "raw": "undefined | { name: string; size?: undefined | number }",
            },
          },
          "label": {
            "defaultValue": undefined,
            "description": "The button label",
            "required": true,
            "type": {
              "name": "string",
              "raw": "string",
            },
          },
          "primary": {
            "defaultValue": {
              "value": "false",
            },
            "description": "Use the primary visual style",
            "required": false,
            "type": {
              "name": "boolean | undefined",
              "raw": "undefined | false | true",
            },
          },
        },
      },
      "stories": [
        {
          "description": "The primary variant of the button",
          "id": "example-button--primary",
          "name": "Primary",
          "snippet": "<Button @click="onClick" primary label="Button" />",
          "source": undefined,
          "summary": undefined,
        },
        {
          "description": undefined,
          "id": "example-button--secondary",
          "name": "Secondary",
          "snippet": "<Button @click="onClick" label="Button">Click me</Button>",
          "source": undefined,
          "summary": undefined,
        },
        {
          "description": undefined,
          "id": "example-button--with-count",
          "name": "With Count",
          "snippet": "<Button @click="onClick" label="Button" :count="3" />",
          "source": undefined,
          "summary": undefined,
        },
        {
          "description": "A story whose own render() defines a literal template",
          "id": "example-button--all-variants",
          "name": "All Variants",
          "snippet": "<div style="display: flex; gap: 0.5rem;">
      <Button primary label="primary" />
      <Button label="secondary" />
    </div>",
          "source": "render: () => ({
      components: {
        Button
      },
      template: \`
          <div style="display: flex; gap: 0.5rem;">
            <Button primary label="primary" />
            <Button label="secondary" />
          </div>
        \`
    })",
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
            "description": "The button label",
            "name": "label",
            "required": true,
            "schema": "string",
            "type": "string",
          },
          {
            "default": "false",
            "description": "Use the primary visual style",
            "name": "primary",
            "required": false,
            "schema": {
              "kind": "enum",
              "schema": [
                "undefined",
                "false",
                "true",
              ],
              "type": "boolean | undefined",
            },
            "type": "boolean | undefined",
          },
          {
            "name": "count",
            "required": false,
            "schema": {
              "kind": "enum",
              "schema": [
                "undefined",
                "number",
              ],
              "type": "number | undefined",
            },
            "type": "number | undefined",
          },
          {
            "description": "Optional leading icon",
            "name": "icon",
            "required": false,
            "schema": {
              "kind": "enum",
              "schema": [
                "undefined",
                {
                  "kind": "object",
                  "schema": {
                    "name": {
                      "name": "name",
                      "required": true,
                      "schema": "string",
                      "type": "string",
                    },
                    "size": {
                      "name": "size",
                      "required": false,
                      "schema": {
                        "kind": "enum",
                        "schema": [
                          "undefined",
                          "number",
                        ],
                        "type": "number | undefined",
                      },
                      "type": "number | undefined",
                    },
                  },
                  "type": "IconConfig",
                },
              ],
              "type": "IconConfig | undefined",
            },
            "type": "IconConfig | undefined",
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

test('uses the literal template from a story-level render() instead of <Component />', async () => {
  const result = await runManifests(manifestEntries);
  const story = result?.components?.components['example-button']?.stories.find(
    (s) => s.id === 'example-button--all-variants'
  );
  expect(story?.snippet).toBe(
    [
      '<div style="display: flex; gap: 0.5rem;">',
      '  <Button primary label="primary" />',
      '  <Button label="secondary" />',
      '</div>',
    ].join('\n')
  );
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

test('emits the full render source for render-based stories', async () => {
  const result = await runManifests(manifestEntries);
  const story = componentOf(result, 'example-datacollection')?.stories.find(
    (s) => s.id === 'example-datacollection--default'
  );
  // Module-level column definitions referenced by the render are inlined into the source…
  expect(story?.source).toContain('const columns');
  expect(story?.source).toContain('h(DataTableHeaderCell');
  expect(story?.source).toContain('calculateColumnSum(columns)');
  // …and the verbatim render (setup + template) is captured, not just the template snippet.
  expect(story?.source).toContain('render:');
  expect(story?.source).toContain('template:');
});

test('documents referenced storyless sub-components as their own entries', async () => {
  const result = await runManifests(manifestEntries);
  const headerCell = componentOf(result, 'data-table-header-cell');

  expect(headerCell).toBeDefined();
  expect(headerCell?.name).toBe('DataTableHeaderCell');
  // No story of its own — it is only referenced.
  expect(headerCell?.stories).toEqual([]);
  expect(headerCell?.referencedBy).toEqual(['example-datacollection']);
  // It carries real prop documentation and a usable import statement.
  expect(headerCell?.import).toBe("import DataTableHeaderCell from './DataTableHeaderCell.vue';");
  expect(headerCell?.vueComponentMeta?.props?.[0]?.name).toBe('column');
  expect(headerCell?.reactComponentMeta?.props.column).toBeDefined();
  expect(headerCell?.error).toBeUndefined();
});

test('does not duplicate a referenced component that also has its own story', async () => {
  const result = await runManifests(manifestEntries);
  // DataCollection is the primary component of its story — it must not also appear as a referenced
  // entry, and its story-backed entry has no referencedBy marker.
  const dataCollection = componentOf(result, 'example-datacollection');
  expect(dataCollection?.referencedBy).toBeUndefined();
  expect(dataCollection?.stories.length).toBeGreaterThan(0);
});
