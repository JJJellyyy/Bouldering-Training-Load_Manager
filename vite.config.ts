import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Mirrors api/toplogger.ts so TopLogger sync also works under `npm run dev`.
      '/api/toplogger': {
        target: 'https://app.toplogger.nu',
        changeOrigin: true,
        rewrite: () => '/graphql',
      },
      // Dev stand-in for api/boardsesh.ts (the production proxy also allow-lists the queries).
      '/api/boardsesh': {
        target: 'https://ws.boardsesh.com',
        changeOrigin: true,
        rewrite: () => '/graphql',
      },
    },
  },
})
