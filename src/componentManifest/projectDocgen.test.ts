import { describe, expect, test } from 'vitest';

import type { ComponentMeta } from 'vue-component-meta';

import {
  buildStockDocgenFields,
  vueMetaToApiMarkdown,
  vueMetaToReactComponentMeta,
} from './projectDocgen.ts';

// Minimal vue-component-meta-shaped fixture. Fields unused by the projection (tags, declarations,
// getters) are cast away to keep the fixture focused.
const meta = {
  name: 'Button',
  props: [
    {
      name: 'label',
      description: 'The button label',
      type: 'string',
      required: true,
    },
    {
      name: 'variant',
      description: '',
      type: 'string',
      default: '"primary"',
      required: false,
      schema: { kind: 'enum', type: 'Variant', schema: ['"primary"', '"secondary"'] },
    },
  ],
  events: [{ name: 'click', description: 'Fired on click', type: '[]', signature: '(): void' }],
  slots: [{ name: 'default', description: 'Default slot', type: 'unknown' }],
  exposed: [{ name: 'focus', description: '', type: '() => void' }],
} as unknown as ComponentMeta;

describe('vueMetaToReactComponentMeta', () => {
  test('projects props into react-docgen shape, expanding enum schemas', () => {
    const { props } = vueMetaToReactComponentMeta(meta);

    expect(props.label).toEqual({
      description: 'The button label',
      type: { name: 'string' },
      defaultValue: undefined,
      required: true,
    });
    expect(props.variant).toEqual({
      description: undefined,
      type: { name: '"primary" | "secondary"' },
      defaultValue: { value: '"primary"' },
      required: false,
    });
  });
});

describe('vueMetaToApiMarkdown', () => {
  test('renders events, slots and exposed as TypeScript-like blocks', () => {
    const markdown = vueMetaToApiMarkdown(meta);

    expect(markdown).toContain('## Events');
    expect(markdown).toContain('click: (): void;');
    expect(markdown).toContain('## Slots');
    expect(markdown).toContain('default: unknown;');
    expect(markdown).toContain('## Exposed');
    expect(markdown).toContain('focus: () => void;');
  });

  test('returns empty string when there is no extra API surface', () => {
    const propsOnly = { props: [], events: [], slots: [], exposed: [] } as unknown as ComponentMeta;
    expect(vueMetaToApiMarkdown(propsOnly)).toBe('');
  });
});

describe('buildStockDocgenFields', () => {
  test('appends the API markdown to the existing description', () => {
    const { description, reactComponentMeta } = buildStockDocgenFields('A button.', meta);

    expect(description?.startsWith('A button.\n\n## Events')).toBe(true);
    expect(reactComponentMeta?.props.label.required).toBe(true);
  });

  test('passes description through untouched when there is no meta', () => {
    expect(buildStockDocgenFields('A button.', undefined)).toEqual({
      description: 'A button.',
      reactComponentMeta: undefined,
    });
  });
});
