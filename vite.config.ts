import { defineConfig } from 'vite';
// GitHub Pages serves at /<repo>/; local dev and artifact builds use relative paths.
// Unhashed asset names keep the artifact file map stable across republishes.
export default defineConfig({
  base: process.env.GH_PAGES ? '/Gravity-Game/' : './',
  worker: {
    format: 'es',
    rollupOptions: { output: { entryFileNames: 'assets/[name].js', chunkFileNames: 'assets/[name].js' } },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
