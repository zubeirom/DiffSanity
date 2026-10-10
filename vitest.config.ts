import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Stylesheets are empty in tests by default; the theme test checks review.css itself.
    css: { include: [/review\.css/] },
  },
});
