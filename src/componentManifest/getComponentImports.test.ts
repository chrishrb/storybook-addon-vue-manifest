import { describe, expect, test } from 'vitest';

import { buildComponentImport } from './getComponentImports.ts';
import type { ResolvedComponentRef } from './resolveComponent.ts';

const ref = (overrides: Partial<ResolvedComponentRef> = {}): ResolvedComponentRef => ({
  localName: 'Button',
  importSource: './Button.vue',
  absPath: '/app/src/stories/Button.vue',
  isPackage: false,
  isDefaultImport: true,
  ...overrides,
});

describe('buildComponentImport', () => {
  test('preserves relative default SFC imports', () => {
    expect(buildComponentImport(ref(), 'some-package', 'some-package')).toBe(
      `import Button from './Button.vue';`
    );
  });

  test('preserves named imports', () => {
    expect(
      buildComponentImport(ref({ isDefaultImport: false }), 'some-package', 'some-package')
    ).toBe(`import { Button } from './Button.vue';`);
  });

  test('keeps bare package specifiers as written', () => {
    expect(
      buildComponentImport(
        ref({ importSource: '@design-system/button', isPackage: true }),
        'some-package',
        '@design-system/button'
      )
    ).toBe(`import Button from '@design-system/button';`);
  });

  test('rewrites cross-package relative imports to a named package import', () => {
    expect(
      buildComponentImport(
        ref({ importSource: '../../lib/src/Button.vue' }),
        'some-package',
        '@my-lib/ui'
      )
    ).toBe(`import { Button } from '@my-lib/ui';`);
  });

  test('honors a valid @import tag override', () => {
    expect(
      buildComponentImport(
        ref(),
        'some-package',
        'some-package',
        `import { Button } from '@design-system/components';`
      )
    ).toBe(`import { Button } from '@design-system/components';`);
  });

  test('ignores an invalid @import tag override', () => {
    expect(buildComponentImport(ref(), 'some-package', 'some-package', 'not an import')).toBe(
      `import Button from './Button.vue';`
    );
  });
});
