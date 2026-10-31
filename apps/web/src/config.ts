import { evaluateConfig, type AppConfig } from '@lovoki/core';

/**
 * The single-file preview build (--mode single) is a demo-only artifact: it never reads Supabase settings.
 * Otherwise the mode comes from VITE_LOVOKI_MODE. A broken real-mode configuration is an error screen.
 */
export const appConfig: AppConfig =
  import.meta.env.MODE === 'single' ? { mode: 'demo' } : evaluateConfig(import.meta.env as unknown as Record<string, string | undefined>);
