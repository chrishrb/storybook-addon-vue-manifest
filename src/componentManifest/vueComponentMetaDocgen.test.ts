// Integration test running the real vue-component-meta checker on files from
// __testfixtures__ — no fs mocking in this file.
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { readFileSync, statSync, utimesSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createChecker } from 'vue-component-meta';

import { ignoreNodeModuleTypes } from '../vueComponentMetaUtils.ts';
import {
  extractComponentMeta,
  invalidateDocgenCache,
  refreshFileIfChanged,
} from './vueComponentMetaDocgen.ts';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '__testfixtures__');
const BUTTON_PATH = join(FIXTURE_DIR, 'Button.vue');

// Building the TypeScript program for the fixture project takes a few seconds.
const TIMEOUT = 60_000;

// Mirror the schema option used by the real checker (createVueComponentMetaChecker) so the fixture
// resolves nested schemas the same way the addon does.
const getFixtureChecker = () =>
  createChecker(join(FIXTURE_DIR, 'tsconfig.json'), {
    forceUseTs: true,
    noDeclarations: true,
    printer: { newLine: 1 },
    schema: { ignore: [ignoreNodeModuleTypes] },
  });

beforeEach(() => {
  invalidateDocgenCache();
});

describe('extractComponentMeta', () => {
  test(
    'extracts props, events and slots from an SFC',
    async () => {
      const checker = getFixtureChecker();
      const result = await extractComponentMeta(checker, BUTTON_PATH);

      expect(result).toBeDefined();
      expect(result?.displayName).toBe('Button');
      expect(result?.exportName).toBe('default');

      const { meta } = result!;
      const props = Object.fromEntries(meta.props.map((prop) => [prop.name, prop]));

      expect(props.label).toMatchObject({
        required: true,
        type: 'string',
        description: 'Button contents',
      });
      expect(props.primary).toMatchObject({ required: false, default: 'false' });
      expect(props.size).toMatchObject({ required: false, default: '"medium"' });

      expect(meta.events.map((event) => event.name)).toContain('click');
      expect(meta.slots.map((slot) => slot.name)).toContain('default');

      // Global props (key, ref, class, ...) must be filtered out
      expect(Object.keys(props)).not.toContain('key');
      expect(Object.keys(props)).not.toContain('class');
    },
    TIMEOUT
  );

  test(
    'resolves project-owned types into structured schemas',
    async () => {
      const checker = getFixtureChecker();
      const result = await extractComponentMeta(checker, BUTTON_PATH);

      const size = result!.meta.props.find((prop) => prop.name === 'size');
      // The string-literal union is expanded into its members rather than left as a flat string.
      expect(size?.schema).toMatchObject({
        kind: 'enum',
        schema: expect.arrayContaining(['"small"', '"medium"', '"large"']),
      });
    },
    TIMEOUT
  );

  test(
    'keeps node_modules types opaque and stays serializable',
    async () => {
      const checker = getFixtureChecker();
      const result = await extractComponentMeta(checker, BUTTON_PATH);

      // The `click` event carries a `MouseEvent` payload. MouseEvent is declared in node_modules,
      // so it must stay an opaque type string instead of expanding into hundreds of DOM props.
      const click = result!.meta.events.find((event) => event.name === 'click');
      expect(click?.schema).toEqual(['MouseEvent']);

      // The meta must be JSON-serializable without blowing up in size.
      expect(() => JSON.stringify(result?.meta)).not.toThrow();
      expect(JSON.stringify(result?.meta).length).toBeLessThan(100_000);
    },
    TIMEOUT
  );
});

describe('refreshFileIfChanged', () => {
  test(
    'only updates the checker when the file changed on disk',
    async () => {
      const checker = getFixtureChecker();
      const updateFile = vi.spyOn(checker, 'updateFile');

      // First sighting registers the mtime without updating the (fresh) checker.
      refreshFileIfChanged(checker, BUTTON_PATH);
      expect(updateFile).not.toHaveBeenCalled();

      // Unchanged file → still no update.
      refreshFileIfChanged(checker, BUTTON_PATH);
      expect(updateFile).not.toHaveBeenCalled();

      // Bump the file's mtime without changing its content.
      const { atime, mtimeMs } = statSync(BUTTON_PATH);
      utimesSync(BUTTON_PATH, atime, new Date(mtimeMs + 1000));
      refreshFileIfChanged(checker, BUTTON_PATH);
      expect(updateFile).toHaveBeenCalledWith(BUTTON_PATH, readFileSync(BUTTON_PATH, 'utf-8'));
    },
    TIMEOUT
  );
});
