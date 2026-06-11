import { describe, expect, test } from 'vitest';

import { dedent } from 'ts-dedent';

import { extractJSDocInfo } from './jsdocTags.ts';

describe('extractJSDocInfo', () => {
  test('extracts plain description', () => {
    const { description, tags } = extractJSDocInfo('Primary UI component');
    expect(description).toBe('Primary UI component');
    expect(tags).toEqual({});
  });

  test('extracts tags with description', () => {
    const { description, tags } = extractJSDocInfo(dedent`
      A button component

      @summary A simple button
      @import import { Button } from '@design-system/components';
    `);
    expect(description).toBe('A button component');
    expect(tags.summary).toEqual(['A simple button']);
    expect(tags.import).toEqual([`import { Button } from '@design-system/components';`]);
  });

  test('groups repeated tags', () => {
    const { tags } = extractJSDocInfo(dedent`
      @example first example
      @example second example
    `);
    expect(tags.example).toEqual(['first example', 'second example']);
  });
});
