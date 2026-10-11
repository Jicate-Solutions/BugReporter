import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Unit tests for server code (API route handlers, middleware). Node
// environment: nothing here renders React. `@/` mirrors tsconfig's paths.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
