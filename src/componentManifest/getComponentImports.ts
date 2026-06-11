import { babelParse, types as t } from 'storybook/internal/babel';

import path from 'pathe';

import type { ResolvedComponentRef } from './resolveComponent.ts';
import { cachedFindUp, cachedReadTextFileSync } from './utils.ts';

/** Find the nearest package.json for the component (or story) file and return its `name` field. */
export function getPackageInfo(
  componentPath: string | undefined,
  fallbackPath: string
): string | undefined {
  const nearestPkg = cachedFindUp('package.json', {
    cwd: path.dirname(componentPath ?? fallbackPath),
  });

  try {
    if (!nearestPkg) {
      return undefined;
    }

    const parsed = JSON.parse(cachedReadTextFileSync(nearestPkg));
    return typeof parsed === 'object' &&
      parsed &&
      'name' in parsed &&
      typeof parsed.name === 'string'
      ? parsed.name
      : undefined;
  } catch {
    return undefined;
  }
}

/** Returns true when the import statement string is a valid ES import declaration. */
function isValidImportStatement(statement: string) {
  try {
    const parsed = babelParse(statement);
    return parsed.program.body.some((node) => t.isImportDeclaration(node));
  } catch {
    return false;
  }
}

/**
 * Build an import declaration for a Vue component.
 *
 * @example
 *
 * ```ts
 * // Local SFC (relative import preserved as written in the story file):
 * import Button from './Button.vue';
 *
 * // Component from a different package (rewritten to a named package import):
 * import { Button } from '@my-lib/ui';
 * ```
 */
export function buildComponentImport(
  ref: ResolvedComponentRef,
  storyPackageName: string | undefined,
  componentPackageName: string | undefined,
  importOverride?: string
): string {
  if (importOverride && isValidImportStatement(importOverride)) {
    return importOverride;
  }

  const specifier = ref.isDefaultImport ? ref.localName : `{ ${ref.localName} }`;

  // A relative import that crosses into another package (e.g. monorepo workspace lib) is
  // rewritten to a named import from that package; bare package specifiers and local relative
  // imports are kept as written in the story file.
  if (!ref.isPackage && componentPackageName && componentPackageName !== storyPackageName) {
    return `import { ${ref.localName} } from '${componentPackageName}';`;
  }

  return `import ${specifier} from '${ref.importSource}';`;
}
