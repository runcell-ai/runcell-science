import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(desktopRoot, '../..')

await build({
  entryPoints: [path.join(repoRoot, 'apps/server/src/index.ts')],
  outfile: path.join(desktopRoot, 'dist-server/index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  packages: 'bundle',
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);'
  },
  external: ['better-sqlite3']
})
