import { defineConfig } from 'vite';
// GitHub Pages serves at /<repo>/; local dev and single-file builds use '/'.
export default defineConfig({
  base: process.env.GH_PAGES ? '/Gravity-Game/' : './',
  build: { target: 'es2022' },
});
