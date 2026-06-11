/** Options accepted by this addon (via the `addons` entry in `.storybook/main.ts`). */
export interface VueManifestAddonOptions {
  /**
   * Path to the tsconfig used by the vue-component-meta checker, relative to the project root.
   * Falls back to the `docgen.tsconfig` framework option of `@storybook/vue3-vite`, then to
   * `tsconfig.json`.
   */
  tsconfig?: string;
}

/** Shape of the `@storybook/vue3-vite` framework `docgen` option this addon understands. */
type VueDocgenFrameworkOption =
  | boolean
  | string
  | { plugin?: string; tsconfig?: string }
  | undefined;

/**
 * Resolves the tsconfig path for the checker from addon options and the vue3-vite framework
 * `docgen` option.
 */
export function resolveTsconfigPath(
  addonOptions: VueManifestAddonOptions | undefined,
  framework: unknown
): string {
  if (addonOptions?.tsconfig) {
    return addonOptions.tsconfig;
  }

  const frameworkOptions =
    framework && typeof framework === 'object' && 'options' in framework
      ? (framework.options as { docgen?: VueDocgenFrameworkOption } | undefined)
      : undefined;
  const docgen = frameworkOptions?.docgen;

  if (docgen && typeof docgen === 'object' && docgen.tsconfig) {
    return docgen.tsconfig;
  }

  return 'tsconfig.json';
}
