import { defineConfig } from 'vitest/config';

// Integration tests: real GoTrue, PostgREST and Storage on the LOCAL Supabase stack (Docker + Supabase CLI).
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.int.test.ts'],
    testTimeout: 60_000, hookTimeout: 180_000,
    fileParallelism: false,
    globalSetup: ['tests/integration/global-setup.ts'],
  },
});
