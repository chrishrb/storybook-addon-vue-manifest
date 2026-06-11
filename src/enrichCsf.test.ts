import { beforeEach, describe, expect, test, vi } from 'vitest';

import { recast } from 'storybook/internal/babel';
import { loadCsf } from 'storybook/internal/csf-tools';

import { dedent } from 'ts-dedent';
import type { ComponentMeta } from 'vue-component-meta';

import { resolveComponentRef } from './componentManifest/resolveComponent.ts';
import { extractComponentMeta, getChecker } from './componentManifest/vueComponentMetaDocgen.ts';
import { enrichCsf } from './enrichCsf.ts';

vi.mock(import('./componentManifest/resolveComponent.ts'));
vi.mock(import('./componentManifest/vueComponentMetaDocgen.ts'));

const componentMeta = {
  type: 1,
  props: [{ name: 'label' }, { name: 'primary' }],
  events: [{ name: 'click' }],
  slots: [],
  exposed: [],
} as unknown as ComponentMeta;

const makeOptions = (features: Record<string, unknown>) =>
  ({
    presets: {
      apply: vi.fn(async (key: string) => {
        if (key === 'features') {
          return features;
        }
        if (key === 'framework') {
          return { name: '@storybook/vue3-vite', options: {} };
        }
        return undefined;
      }),
    },
  }) as unknown as Parameters<typeof enrichCsf>[1];

const storyCode = dedent`
  import Button from './Button.vue';

  export default { component: Button, args: { onClick: () => {} } };
  export const Primary = { args: { primary: true, label: 'Button' } };
`;

const parseCsf = (code: string) =>
  loadCsf(code, {
    makeTitle: (title) => title || 'Example',
    fileName: '/app/src/stories/Button.stories.ts',
  }).parse();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveComponentRef).mockReturnValue({
    ref: {
      localName: 'Button',
      importSource: './Button.vue',
      absPath: '/app/src/stories/Button.vue',
      isPackage: false,
      isDefaultImport: true,
    },
  });
  vi.mocked(getChecker).mockResolvedValue({} as Awaited<ReturnType<typeof getChecker>>);
  vi.mocked(extractComponentMeta).mockResolvedValue({
    meta: componentMeta,
    displayName: 'Button',
    exportName: 'default',
  });
});

describe('enrichCsf', () => {
  test('returns no enricher when experimentalCodeExamples is disabled', async () => {
    const enricher = await enrichCsf(undefined, makeOptions({}));
    expect(enricher).toBeUndefined();
  });

  test('injects the generated snippet into parameters.docs.source.code', async () => {
    const enricher = await enrichCsf(undefined, makeOptions({ experimentalCodeExamples: true }));
    expect(enricher).toBeDefined();

    const csf = parseCsf(storyCode);
    const csfSource = parseCsf(storyCode);
    await enricher!(csf, csfSource);

    const output = recast.print(csf._ast).code;
    expect(output).toContain(`code: "<Button @click=\\"onClick\\" primary label=\\"Button\\" />"`);
    expect(output).toContain('Primary.parameters = {');
  });

  test('does nothing when meta.component is missing', async () => {
    const enricher = await enrichCsf(undefined, makeOptions({ experimentalCodeExamples: true }));

    const code = dedent`
      export default { title: 'Example' };
      export const Primary = {};
    `;
    const csf = parseCsf(code);
    const csfSource = parseCsf(code);
    await enricher!(csf, csfSource);

    expect(recast.print(csf._ast).code).not.toContain('parameters');
  });

  test('still generates a best-effort snippet when the component cannot be resolved', async () => {
    vi.mocked(resolveComponentRef).mockReturnValue({
      error: { name: 'Component file not found', message: 'nope' },
    });

    const enricher = await enrichCsf(undefined, makeOptions({ experimentalCodeExamples: true }));
    const csf = parseCsf(storyCode);
    const csfSource = parseCsf(storyCode);
    await enricher!(csf, csfSource);

    const output = recast.print(csf._ast).code;
    expect(output).toContain(`code: "<Button @click=\\"onClick\\" primary label=\\"Button\\" />"`);
  });
});
