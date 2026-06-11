import { describe, expect, test } from 'vitest';

import { loadCsf } from 'storybook/internal/csf-tools';

import { dedent } from 'ts-dedent';
import type { ComponentMeta } from 'vue-component-meta';

import { generateVueSnippet, mergeArgsFromAst } from './generateCodeSnippet.ts';

const componentMeta = {
  type: 1,
  props: [{ name: 'label' }, { name: 'primary' }, { name: 'count' }, { name: 'user' }],
  events: [{ name: 'click' }, { name: 'submit' }],
  slots: [{ name: 'default' }, { name: 'footer' }],
  exposed: [],
} as unknown as ComponentMeta;

const parseCsf = (code: string) =>
  loadCsf(code, { makeTitle: (title) => title || 'Example' }).parse();

describe('mergeArgsFromAst', () => {
  test('merges meta and story args with story args taking precedence', () => {
    const csf = parseCsf(dedent`
      import Button from './Button.vue';
      export default { component: Button, args: { label: 'meta', primary: true } };
      export const Primary = { args: { label: 'story', count: 3 } };
    `);

    expect(mergeArgsFromAst(csf._metaNode, csf._storyAnnotations.Primary)).toEqual({
      label: 'story',
      primary: true,
      count: 3,
    });
  });

  test('resolves literal values and leaves expressions undefined', () => {
    const csf = parseCsf(dedent`
      import { fn } from 'storybook/test';
      import Button from './Button.vue';
      export default { component: Button };
      export const Primary = {
        args: {
          str: 'text',
          num: -4,
          bool: false,
          nil: null,
          arr: [1, 'two'],
          obj: { nested: { deep: true } },
          tpl: \`template\`,
          handler: fn(),
        },
      };
    `);

    expect(mergeArgsFromAst(csf._metaNode, csf._storyAnnotations.Primary)).toEqual({
      str: 'text',
      num: -4,
      bool: false,
      nil: null,
      arr: [1, 'two'],
      obj: { nested: { deep: true } },
      tpl: 'template',
      handler: undefined,
    });
  });
});

describe('generateVueSnippet', () => {
  test('self-closes without args', () => {
    expect(generateVueSnippet(undefined, componentMeta, 'Button')).toBe('<Button />');
    expect(generateVueSnippet({}, componentMeta, 'Button')).toBe('<Button />');
  });

  test('renders string props as plain attributes', () => {
    expect(generateVueSnippet({ label: 'Click me' }, componentMeta, 'Button')).toBe(
      '<Button label="Click me" />'
    );
  });

  test('escapes double quotes in string props', () => {
    expect(generateVueSnippet({ label: 'a "b"' }, componentMeta, 'Button')).toBe(
      '<Button label="a &quot;b&quot;" />'
    );
  });

  test('renders boolean true as bare attribute and other primitives as bindings', () => {
    expect(
      generateVueSnippet({ primary: true, count: 3, label: 'x' }, componentMeta, 'Button')
    ).toBe('<Button primary :count="3" label="x" />');
    expect(generateVueSnippet({ primary: false }, componentMeta, 'Button')).toBe(
      '<Button :primary="false" />'
    );
  });

  test('renders events known to the component meta as listeners', () => {
    expect(generateVueSnippet({ onClick: undefined }, componentMeta, 'Button')).toBe(
      '<Button @click="onClick" />'
    );
    expect(generateVueSnippet({ submit: undefined }, componentMeta, 'Button')).toBe(
      '<Button @submit="submit" />'
    );
  });

  test('treats on[A-Z] args as events even without component meta', () => {
    expect(generateVueSnippet({ onClick: undefined }, undefined, 'Button')).toBe(
      '<Button @click="onClick" />'
    );
  });

  test('renders default slot content as children', () => {
    expect(generateVueSnippet({ default: 'Hello' }, componentMeta, 'Button')).toBe(
      '<Button>Hello</Button>'
    );
  });

  test('renders named slot content as template children', () => {
    expect(generateVueSnippet({ footer: 'Footer text', label: 'x' }, componentMeta, 'Button')).toBe(
      '<Button label="x"><template #footer>Footer text</template></Button>'
    );
  });

  test('serializes object args into a binding', () => {
    expect(
      generateVueSnippet({ user: { name: 'Jane Doe', age: 30 } }, componentMeta, 'Button')
    ).toBe(`<Button :user="{name: 'Jane Doe', age: 30}" />`);
  });

  test('falls back to a placeholder binding for unresolvable non-event args', () => {
    expect(generateVueSnippet({ label: undefined }, componentMeta, 'Button')).toBe(
      '<Button :label="label" />'
    );
  });
});
