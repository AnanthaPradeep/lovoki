import { defineConfig } from 'vitest/config';

// Default `npm test`: unit and MOCKED tests only. Integration tests need the local Supabase stack
// and run with `npm run test:integration` (vitest.integration.config.ts).
export default defineConfig({ test: { include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'], exclude: ['**/node_modules/**', 'tests/integration/**'] } });
