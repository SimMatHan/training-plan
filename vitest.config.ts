import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Egen config, så tests ikke kører Vite-plugins (PWA, Tailwind).
export default defineConfig({
  resolve: { alias: { 'cloudflare:workers': path.resolve(import.meta.dirname, 'test/stubs/cloudflare-workers.ts') } },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // OAuth- og MCP-pakkerne importerer "cloudflare:workers"; de skal gennem Vite for at aliaset virker.
    server: { deps: { inline: [/workers-oauth-provider/, /[\\/]agents[\\/]/, /@modelcontextprotocol/] } },
  },
});
