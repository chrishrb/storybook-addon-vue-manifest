# storybook-addon-vue-manifest

Generates a Storybook **component manifest** for Vue 3 projects using
[vue-component-meta](https://github.com/vuejs/language-tools/tree/master/packages/component-meta)
(Vue language tools / Volar). The manifest contains structured component documentation —
props, events, slots, descriptions, import statements and per-story Vue template snippets —
and is the data source for the [Storybook MCP server](https://github.com/storybookjs/mcp),
enabling AI-assisted workflows for Vue projects.

## Requirements

- Storybook ≥ 10.5 (the experimental component manifest infrastructure lives in Storybook core)
- `@storybook/vue3-vite`
- Vue 3 with TypeScript

## Usage

```bash
npm install --save-dev @chrishrb/storybook-addon-vue-manifest
```

```ts
// .storybook/main.ts
const config: StorybookConfig = {
  framework: '@storybook/vue3-vite',
  addons: [
    // ...
    '@chrishrb/storybook-addon-vue-manifest',
  ],
  features: {
    // required: enables the manifest routes and build output in Storybook core
    componentsManifest: true,
    // optional: also injects generated Vue snippets into docs source blocks
    experimentalCodeExamples: true,
  },
};
```

### Generating the manifest into a file

Run a static build — Storybook core writes every manifest to disk:

```bash
storybook build
# -> storybook-static/manifests/components.json
```

During `storybook dev` the same manifest is served live at
`http://localhost:6006/manifests/components.json`, plus an HTML debugger at
`/manifests/components.html`.

With `@storybook/addon-docs` installed, unattached MDX docs additionally produce
`manifests/docs.json`; attached MDX is embedded into `components.json` per component
(both handled by addon-docs, not this addon).

## Options

```ts
addons: [
  {
    name: '@chrishrb/storybook-addon-vue-manifest',
    options: {
      // tsconfig used by the vue-component-meta checker (relative to the project root).
      // Defaults to the vue3-vite framework `docgen.tsconfig` option, then 'tsconfig.json'.
      tsconfig: 'tsconfig.app.json',
    },
  },
],
```

## Output shape

```jsonc
// manifests/components.json
{
  "v": 0,
  "components": {
    "example-button": {
      "id": "example-button",
      "name": "Button",
      "path": "./src/stories/Button.stories.ts",
      "import": "import Button from './Button.vue';",
      "description": "Primary UI component for user interaction",
      "summary": "A simple button",
      "jsDocTags": { "summary": ["A simple button"] },
      "stories": [
        {
          "id": "example-button--primary",
          "name": "Primary",
          "snippet": "<Button primary @click=\"onClick\" label=\"Button\" />",
          // verbatim render source for render-based stories (see "Story source" below)
          "source": "render: () => ({ /* setup(), components, template */ })"
        }
      ],
      // raw vue-component-meta data (props/events/slots/exposed, with resolved type schemas)
      "vueComponentMeta": { "props": [/* ... */], "events": [/* ... */] }
    },
    // sub-components referenced by a story but lacking a story of their own get their own entry,
    // tagged with the component ids that reference them (see "Referenced components" below)
    "data-table-header-cell": {
      "id": "data-table-header-cell",
      "name": "DataTableHeaderCell",
      "path": "src/components/DataTableHeaderCell.vue",
      "stories": [],
      "import": "import DataTableHeaderCell from '@my-lib/ui';",
      "referencedBy": ["example-button"],
      "vueComponentMeta": { "props": [/* ... */] }
    }
  },
  "meta": { "docgen": "vue-component-meta", "durationMs": 875 }
}
```

### Story source

The `snippet` is the rendered Vue template. For stories written with a `render` function, the
template alone references locals it does not define — e.g. `<DataCollection :columns="columns" />`,
where `columns` is built in `setup()`. The `source` field carries the **verbatim render function**
(its `components`/`setup`/`data`/`template`), preceded by the module-level declarations the render
references (`const columns = …`, helpers, local types), resolved transitively so the snapshot is
self-contained. Args-only stories (no `render`) omit `source` — the snippet already conveys
everything.

### Referenced components

Stories often render sub-components that have no story of their own (cell renderers used inside a
table's column definitions, etc.). Each such component — registered in a `components: {}` map or
passed to `h(...)` — is resolved, run through vue-component-meta, and emitted as its own manifest
entry so it appears in component listings with full prop docs and a usable `import`. These entries
carry a `referencedBy` array (the component ids whose stories use them) and an empty `stories`
array, and are de-duplicated against components that already have a story-backed entry.

### Type schema resolution

Each prop/event/slot/exposed entry carries a `schema` describing its resolved type. Complex types
are expanded into a structured shape rather than left as a flat type string, so MCP clients and
docs tooling can introspect them:

- unions → `{ "kind": "enum", "schema": ["\"sm\"", "\"md\"", "\"lg\""] }`
- arrays → `{ "kind": "array", "schema": [/* element type */] }`
- objects → `{ "kind": "object", "schema": { "label": { /* nested prop */ } } }`
- callbacks → `{ "kind": "event", "schema": [/* parameter types */] }`

To keep the manifest bounded, **types declared in `node_modules` are left as opaque type strings**
instead of being expanded — the same approach Storybook applies to react-docgen-typescript
(`propFilter: !/node_modules/.test(parent.fileName)`). This prevents large/circular DOM and library
types (`MouseEvent`, `HTMLElement`, third-party generics) from exploding the output, while your own
project types are fully resolved.

> **Generic components:** a named object type parameterized by an unbound type parameter (e.g. a
> prop typed `Foo<T>` on a `<script setup generic="T">` component) stays a type string and is not
> expanded. Unions, string-literal unions and arrays still resolve. This is a vue-component-meta
> limitation — the type parameter has no concrete binding to resolve against.

## Notes & limitations

- Only stories tagged `manifest` are included — Storybook adds that tag to every story by
  default, so usually everything is in.
- Stories whose `meta.component` is defined inline (not imported from a file) produce an
  error entry instead of docgen data.
- tsconfig **project references** are not supported by vue-component-meta
  ([vuejs/language-tools#3896](https://github.com/vuejs/language-tools/issues/3896)); the
  checker falls back to a referenceless project over the package root. Point the `tsconfig`
  option at a non-referencing config (e.g. `tsconfig.app.json`) for alias resolution.
- The first manifest request in dev builds a TypeScript program and can take a few seconds;
  subsequent requests reuse the checker.
- `experimentalCodeExamples` snippet injection works best on Storybook versions where the
  csf-plugin passes the story file path to enrichers; on older versions snippets fall back to
  heuristics (`on*` args treated as events) instead of vue-component-meta classification.
