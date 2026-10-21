import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

// Static client configuration must exist during the Vercel build, not just at runtime.
if (process.env.VERCEL === '1') {
  const missing = [
    'PUBLIC_SUPABASE_URL',
    'PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  ].filter((name) => !process.env[name]?.trim());
  if (missing.length) {
    throw new Error(
      `Missing Vercel build environment variables: ${missing.join(', ')}`,
    );
  }
}

export default defineConfig({
  site: process.env.SITE_URL || undefined,
  integrations: [mdx()],
  output: 'static',
});
