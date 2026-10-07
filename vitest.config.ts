import { defineConfig } from 'vitest/config';

// Egen config, så tests ikke kører Vite-plugins (PWA, Tailwind).
export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
