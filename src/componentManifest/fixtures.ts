import { Tag } from './entries.ts';
import type { IndexEntry } from 'storybook/internal/types';

import { dedent } from 'ts-dedent';
import type { ComponentMeta } from 'vue-component-meta';

export const fsMocks = {
  ['./package.json']: JSON.stringify({ name: 'some-package' }),
  ['./src/stories/Button.stories.ts']: dedent`
        import type { Meta, StoryObj } from '@storybook/vue3';
        import { fn } from 'storybook/test';
        import Button from './Button.vue';

        /**
         * Primary UI component for user interaction
         *
         * @summary A simple button
         */
        const meta = {
          title: 'Example/Button',
          component: Button,
          args: { onClick: fn() },
        } satisfies Meta<typeof Button>;
        export default meta;
        type Story = StoryObj<typeof meta>;

        /** The primary variant of the button */
        export const Primary: Story = { args: { primary: true, label: 'Button' } };
        export const Secondary: Story = { args: { label: 'Button', default: 'Click me' } };
        export const WithCount: Story = { args: { label: 'Button', count: 3 } };
        export const Hidden: Story = { args: { label: 'Hidden' } };

        /** A story whose own render() defines a literal template */
        export const AllVariants: Story = {
          render: () => ({
            components: { Button },
            template: \`
              <div style="display: flex; gap: 0.5rem;">
                <Button primary label="primary" />
                <Button label="secondary" />
              </div>
            \`,
          }),
        };`,
  ['./src/stories/Button.vue']: dedent`
        <script setup lang="ts">
        defineProps<{ label: string; primary?: boolean; count?: number }>();
        defineEmits<{ click: [event: MouseEvent] }>();
        </script>
        <template>
          <button @click="$emit('click', $event)">{{ label }}<slot /></button>
        </template>`,
  ['./src/stories/Header.stories.ts']: dedent`
        import type { Meta, StoryObj } from '@storybook/vue3';
        import Header from './Header.vue';

        const meta = {
          title: 'Example/Header',
          component: Header,
        } satisfies Meta<typeof Header>;
        export default meta;
        type Story = StoryObj<typeof meta>;

        export const LoggedIn: Story = { args: { user: { name: 'Jane Doe' } } };`,
  ['./src/stories/Header.vue']: dedent`
        <script setup lang="ts">
        defineProps<{ user?: { name: string } }>();
        </script>
        <template><header>{{ user?.name }}</header></template>`,
  ['./src/stories/NoComponent.stories.ts']: dedent`
        import type { Meta, StoryObj } from '@storybook/vue3';

        const meta = { title: 'Example/NoComponent' } satisfies Meta;
        export default meta;

        export const Default: StoryObj = {};`,
};

export const buttonComponentMeta = {
  type: 1,
  props: [
    {
      name: 'label',
      type: 'string',
      description: 'The button label',
      required: true,
      schema: 'string',
    },
    {
      name: 'primary',
      type: 'boolean | undefined',
      description: 'Use the primary visual style',
      default: 'false',
      required: false,
      schema: { kind: 'enum', type: 'boolean | undefined', schema: ['undefined', 'false', 'true'] },
    },
    {
      name: 'count',
      type: 'number | undefined',
      required: false,
      schema: { kind: 'enum', type: 'number | undefined', schema: ['undefined', 'number'] },
    },
    {
      // Object alias: `type` stays the opaque name, `raw` expands the resolved schema.
      name: 'icon',
      type: 'IconConfig | undefined',
      description: 'Optional leading icon',
      required: false,
      schema: {
        kind: 'enum',
        type: 'IconConfig | undefined',
        schema: [
          'undefined',
          {
            kind: 'object',
            type: 'IconConfig',
            schema: {
              name: { name: 'name', type: 'string', required: true, schema: 'string' },
              size: {
                name: 'size',
                type: 'number | undefined',
                required: false,
                schema: { kind: 'enum', type: 'number | undefined', schema: ['undefined', 'number'] },
              },
            },
          },
        ],
      },
    },
  ],
  events: [{ name: 'click' }],
  slots: [{ name: 'default' }],
  exposed: [],
} as unknown as ComponentMeta;

export const headerComponentMeta = {
  type: 1,
  props: [{ name: 'user' }],
  events: [],
  slots: [],
  exposed: [],
} as unknown as ComponentMeta;

export const componentMetaByPath: Record<string, ComponentMeta> = {
  '/app/src/stories/Button.vue': buttonComponentMeta,
  '/app/src/stories/Header.vue': headerComponentMeta,
};

export const indexJson: { v: number; entries: Record<string, IndexEntry> } = {
  v: 5,
  entries: {
    'example-button--primary': {
      type: 'story',
      subtype: 'story',
      id: 'example-button--primary',
      name: 'Primary',
      title: 'Example/Button',
      importPath: './src/stories/Button.stories.ts',
      componentPath: './src/stories/Button.vue',
      tags: [Tag.DEV, Tag.TEST, Tag.AUTODOCS, Tag.MANIFEST],
      exportName: 'Primary',
    },
    'example-button--secondary': {
      type: 'story',
      subtype: 'story',
      id: 'example-button--secondary',
      name: 'Secondary',
      title: 'Example/Button',
      importPath: './src/stories/Button.stories.ts',
      componentPath: './src/stories/Button.vue',
      tags: [Tag.DEV, Tag.TEST, Tag.AUTODOCS, Tag.MANIFEST],
      exportName: 'Secondary',
    },
    'example-button--with-count': {
      type: 'story',
      subtype: 'story',
      id: 'example-button--with-count',
      name: 'With Count',
      title: 'Example/Button',
      importPath: './src/stories/Button.stories.ts',
      componentPath: './src/stories/Button.vue',
      tags: [Tag.DEV, Tag.TEST, Tag.AUTODOCS, Tag.MANIFEST],
      exportName: 'WithCount',
    },
    'example-button--all-variants': {
      type: 'story',
      subtype: 'story',
      id: 'example-button--all-variants',
      name: 'All Variants',
      title: 'Example/Button',
      importPath: './src/stories/Button.stories.ts',
      componentPath: './src/stories/Button.vue',
      tags: [Tag.DEV, Tag.TEST, Tag.AUTODOCS, Tag.MANIFEST],
      exportName: 'AllVariants',
    },
    // No MANIFEST tag — must not show up in the manifest stories
    'example-button--hidden': {
      type: 'story',
      subtype: 'story',
      id: 'example-button--hidden',
      name: 'Hidden',
      title: 'Example/Button',
      importPath: './src/stories/Button.stories.ts',
      componentPath: './src/stories/Button.vue',
      tags: [Tag.DEV, Tag.TEST],
      exportName: 'Hidden',
    },
    // Attached MDX docs entry — resolves the story file via storiesImports
    'example-header--docs': {
      id: 'example-header--docs',
      title: 'Example/Header',
      name: 'Docs',
      importPath: './src/stories/Header.mdx',
      type: 'docs',
      tags: [Tag.DEV, Tag.TEST, Tag.ATTACHED_MDX, Tag.MANIFEST],
      storiesImports: ['./src/stories/Header.stories.ts'],
    },
    'example-header--logged-in': {
      type: 'story',
      subtype: 'story',
      id: 'example-header--logged-in',
      name: 'Logged In',
      title: 'Example/Header',
      importPath: './src/stories/Header.stories.ts',
      componentPath: './src/stories/Header.vue',
      tags: [Tag.DEV, Tag.TEST, Tag.AUTODOCS, Tag.MANIFEST],
      exportName: 'LoggedIn',
    },
    'example-nocomponent--default': {
      type: 'story',
      subtype: 'story',
      id: 'example-nocomponent--default',
      name: 'Default',
      title: 'Example/NoComponent',
      importPath: './src/stories/NoComponent.stories.ts',
      tags: [Tag.DEV, Tag.TEST, Tag.MANIFEST],
      exportName: 'Default',
    },
  },
};
