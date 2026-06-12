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
          "snippet": "<Button primary @click=\"onClick\" label=\"Button\" />"
        }
      ],
      // raw vue-component-meta data (props/events/slots/exposed, schemas stripped)
      "vueComponentMeta": { "props": [/* ... */], "events": [/* ... */] }
    }
  },
  "meta": { "docgen": "vue-component-meta", "durationMs": 875 }
}
```

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
