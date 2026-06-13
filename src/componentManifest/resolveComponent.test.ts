import { beforeEach, describe, expect, test, vi } from 'vitest';

import { loadCsf } from 'storybook/internal/csf-tools';

import { vol } from 'memfs';
import { dedent } from 'ts-dedent';

import { setupMemfsMocks } from './memfs-test-setup.ts';
import { resolveComponentRef } from './resolveComponent.ts';

// Opt into memfs so the barrel files below are readable/resolvable.
vi.mock('node:fs');
vi.mock('node:fs/promises');
vi.mock(import('./utils.ts'), { spy: true });
vi.mock('empathic/find', { spy: true });
vi.mock('tsconfig-paths', { spy: true });

const STORY_PATH = '/app/src/ui/accordion/Accordion.stories.ts';

/** Parses story source into a CsfFile rooted at the accordion story path. */
const parseStory = (code: string) =>
  loadCsf(code, { makeTitle: (title) => title || 'Accordion', fileName: STORY_PATH }).parse();

beforeEach(() => {
  setupMemfsMocks();
});

describe('resolveComponentRef barrel re-export following', () => {
  test('follows `export { default as X } from "./X.vue"` to the underlying SFC', () => {
    vol.fromJSON(
      {
        './src/ui/accordion/index.ts': dedent`
          export { default as Accordion } from './Accordion.vue';
          export { default as AccordionItem } from './AccordionItem.vue';
        `,
        './src/ui/accordion/Accordion.vue': '<template><div /></template>',
      },
      '/app'
    );

    const csf = parseStory(dedent`
      import { Accordion } from './index';
      export default { title: 'Accordion', component: Accordion };
      export const Default = {};
    `);

    const { ref, error } = resolveComponentRef(csf, STORY_PATH);

    expect(error).toBeUndefined();
    // Meta is extracted from the SFC, but the import source is preserved for the import statement.
    expect(ref?.absPath).toBe('/app/src/ui/accordion/Accordion.vue');
    expect(ref?.componentExportName).toBe('default');
    expect(ref?.importSource).toBe('./index');
  });

  test('follows nested barrels down to the SFC', () => {
    vol.fromJSON(
      {
        './src/ui/accordion/index.ts': `export { Accordion } from './accordion';`,
        './src/ui/accordion/accordion.ts': `export { default as Accordion } from './Accordion.vue';`,
        './src/ui/accordion/Accordion.vue': '<template><div /></template>',
      },
      '/app'
    );

    const csf = parseStory(dedent`
      import { Accordion } from './index';
      export default { title: 'Accordion', component: Accordion };
      export const Default = {};
    `);

    const { ref } = resolveComponentRef(csf, STORY_PATH);

    expect(ref?.absPath).toBe('/app/src/ui/accordion/Accordion.vue');
    expect(ref?.componentExportName).toBe('default');
  });

  test('resolves the source-side name of an aliased re-export', () => {
    vol.fromJSON(
      {
        './src/ui/accordion/index.ts': `export { Root as Accordion } from './Accordion.vue';`,
        './src/ui/accordion/Accordion.vue': '<template><div /></template>',
      },
      '/app'
    );

    const csf = parseStory(dedent`
      import { Accordion } from './index';
      export default { title: 'Accordion', component: Accordion };
      export const Default = {};
    `);

    const { ref } = resolveComponentRef(csf, STORY_PATH);

    expect(ref?.absPath).toBe('/app/src/ui/accordion/Accordion.vue');
    expect(ref?.componentExportName).toBe('Root');
  });

  test('leaves a direct SFC import untouched (no re-export to follow)', () => {
    vol.fromJSON({ './src/ui/accordion/Accordion.vue': '<template><div /></template>' }, '/app');

    const csf = parseStory(dedent`
      import Accordion from './Accordion.vue';
      export default { title: 'Accordion', component: Accordion };
      export const Default = {};
    `);

    const { ref } = resolveComponentRef(csf, STORY_PATH);

    expect(ref?.absPath).toBe('/app/src/ui/accordion/Accordion.vue');
    expect(ref?.componentExportName).toBeUndefined();
  });
});
