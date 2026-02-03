import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
  ],
  optimizeDeps: {
    include: [
      '@ngageoint/mgrs-js',
      '@ngageoint/grid-js',
    ],
    exclude: ['js_cols'],
  },
  build: {
    commonjsOptions: {
      include: [/js_cols/, /node_modules/],
      transformMixedEsModules: true,
    },
  },
})
