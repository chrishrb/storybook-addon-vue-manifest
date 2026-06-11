/**
 * Shared memfs mock setup for tests that use the in-memory filesystem.
 *
 * Usage in test files: vi.mock('node:fs'); vi.mock('node:fs/promises'); vi.mock(import('./utils.ts'),
 * { spy: true }); vi.mock('empathic/find', { spy: true }); vi.mock('tsconfig-paths', { spy: true });
 *
 * BeforeEach(() => { setupMemfsMocks(); });
 */
import { vi } from 'vitest';

import { vol } from 'memfs';
import path from 'pathe';
import { loadConfig } from 'tsconfig-paths';

import { fsMocks } from './fixtures.ts';
import { cachedFindUp, cachedResolveImport, invalidateCache } from './utils.ts';

export function setupMemfsMocks() {
  vol.reset();
  vi.clearAllMocks();
  invalidateCache();

  vi.spyOn(process, 'cwd').mockReturnValue('/app');
  vol.fromJSON(fsMocks, '/app');

  vi.mocked(loadConfig).mockImplementation(() => ({ resultType: 'failed' as const, message: '' }));
  vi.mocked(cachedFindUp).mockImplementation(() => '/app/package.json');
  vi.mocked(cachedResolveImport).mockImplementation((id, options) => {
    if (
      typeof id === 'string' &&
      id.startsWith('.') &&
      options &&
      'basedir' in options &&
      typeof options.basedir === 'string'
    ) {
      const { basedir } = options;
      const candidates = [id, ...['.vue', '.ts', '.tsx', '.js'].map((ext) => `${id}${ext}`)].map(
        (candidate) => path.resolve(basedir, candidate)
      );
      const existingCandidate = candidates.find((candidate) => vol.existsSync(candidate));

      if (existingCandidate) {
        return existingCandidate;
      }
    }

    throw new Error(`Unable to resolve ${id}`);
  });
}
