import build from '@hono/vite-build/cloudflare-pages'
import devServer from '@hono/vite-dev-server'
import adapter from '@hono/vite-dev-server/cloudflare'
import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: 'public',
  plugins: [
    build({
      outputDir: 'dist',
      staticPaths: ['/index.html', '/preview.html', '/static/*', '/sw.js'],
    }),
    devServer({
      adapter,
      entry: 'src/index.tsx',
      exclude: [
        /.*\.css$/,
        /.*\.ts$/,
        /.*\.tsx$/,
        /^\/@.+$/,
        /\?t=\d+$/,
        /^\/favicon\.ico$/,
        /^\/static\/.+/,
        /^\/node_modules\/.*/,
      ],
    })
  ],
  server: {
    // Default Vite "localhost" can bind IPv6-only (::1); 127.0.0.1 then fails → axios "Network Error".
    host: true,
    watch: {
      ignored: ['**/.wrangler/**', '**/dist/**', '**/node_modules/**'],
    },
  },
  build: {
    outDir: 'dist',
  },
})
