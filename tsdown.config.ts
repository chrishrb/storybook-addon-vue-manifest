import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/preset.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  platform: 'node',
  // storybook internals must never be bundled — they are resolved from the host project
  external: [/^storybook($|\/)/],
});
