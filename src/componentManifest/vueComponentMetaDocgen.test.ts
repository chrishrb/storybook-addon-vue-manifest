// Integration test running the real vue-component-meta checker on files from
// __testfixtures__ — no fs mocking in this file.
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { readFileSync, statSync, utimesSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createChecker } from 'vue-component-meta';

import {
  extractComponentMeta,
  invalidateDocgenCache,
  refreshFileIfChanged,
} from './vueComponentMetaDocgen.ts';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '__testfixtures__');
const BUTTON_PATH = join(FIXTURE_DIR, 'Button.vue');

// Building the TypeScript program for the fixture project takes a few seconds.
const TIMEOUT = 60_000;

const getFixtureChecker = () =>
  createChecker(join(FIXTURE_DIR, 'tsconfig.json'), {
    forceUseTs: true,
    noDeclarations: true,
    printer: { newLine: 1 },
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
    'strips nested schemas to keep the manifest serializable',
    async () => {
      const checker = getFixtureChecker();
      const result = await extractComponentMeta(checker, BUTTON_PATH);

      // After stripping, the meta must be JSON-serializable without blowing up in size.
      expect(() => JSON.stringify(result?.meta)).not.toThrow();
      const serialized = JSON.stringify(result?.meta);
      expect(serialized.length).toBeLessThan(100_000);
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
