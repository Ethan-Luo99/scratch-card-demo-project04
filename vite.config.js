import { defineConfig } from 'vite'

// PixiJS is heavy and only needed by the scratch card, which is loaded
// on demand: force it into its own stable, lazily fetched chunk instead of
// letting it join the initial vendor/main bundles.
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/pixi.js/')) return 'pixi'
        },
      },
    },
  },
})
