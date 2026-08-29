import { cpSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const copies = [
  ['public/static', 'dist/static'],
  ['public/index.html', 'dist/index.html'],
  ['public/preview.html', 'dist/preview.html'],
  ['public/sw.js', 'dist/sw.js'],
  ['public/manifest.webmanifest', 'dist/manifest.webmanifest'],
  ['public/icon-192.png', 'dist/icon-192.png'],
  ['public/icon-512.png', 'dist/icon-512.png'],
  ['public/badge-72.png', 'dist/badge-72.png'],
  ['public/brand', 'dist/brand'],
  ['public/_headers', 'dist/_headers'],
  ['public/_routes.json', 'dist/_routes.json'],
]

for (const [src, dest] of copies) {
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(src, dest, { recursive: true })
}

console.log('Copied public assets → dist/')
