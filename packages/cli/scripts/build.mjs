#!/usr/bin/env node
// Bundles the server + web app + runtime helpers into a self-contained `dist/`
// that `bin/runcell-science.mjs` can launch without a monorepo checkout.
//
// This mirrors apps/desktop/scripts/build-server.mjs. It expects the upstream
// workspace builds to already exist — the CLI declares them as devDependencies,
// so the topological `yarn build` builds them before this runs. Run `yarn build`
// from the repo root if you invoke this directly.
import { access, cp, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(cliRoot, '../..')
const distDir = path.join(cliRoot, 'dist')

// createRequire shim so the ESM bundle can `require('better-sqlite3')` (native,
// kept external) and any transitive CommonJS deps.
const nodeRequireBanner =
  'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);'

async function assertInput(inputPath, hint) {
  try {
    await access(inputPath)
  } catch {
    throw new Error(
      `Missing build input: ${path.relative(repoRoot, inputPath)}\n  ${hint}`
    )
  }
}

// Preconditions produced by the upstream workspace builds.
await assertInput(
  path.join(repoRoot, 'packages/contracts/dist/index.js'),
  'Run `yarn build` from the repo root first (builds @runcell-science/contracts).'
)
await assertInput(
  path.join(repoRoot, 'apps/web/dist/index.html'),
  'Run `yarn build` from the repo root first (builds @runcell-science/web).'
)

await rm(distDir, { recursive: true, force: true })
await mkdir(distDir, { recursive: true })

// 1. Bundle the API + workspace server. better-sqlite3 is native, so it stays a
//    real dependency of this package and is resolved at runtime.
await build({
  entryPoints: [path.join(repoRoot, 'apps/server/src/index.ts')],
  outfile: path.join(distDir, 'server/index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: false,
  packages: 'bundle',
  banner: { js: nodeRequireBanner },
  external: ['better-sqlite3']
})

// 2. Bundle the science-connectors CLI. The server spawns it as a separate
//    `node <cwd>/packages/science-connectors/dist/cli.js` process at runtime, so
//    it must be self-contained (no node_modules alongside it).
const connectorsDist = path.join(distDir, 'packages/science-connectors/dist')
await build({
  entryPoints: [path.join(repoRoot, 'packages/science-connectors/src/cli.ts')],
  outfile: path.join(connectorsDist, 'cli.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: false,
  packages: 'bundle',
  banner: { js: nodeRequireBanner }
})
// `.js` + this marker makes Node load the bundle as ESM.
await writeFile(path.join(connectorsDist, 'package.json'), `${JSON.stringify({ type: 'module' })}\n`)

// 3. Copy the assets the server reads from disk at runtime.
await cp(path.join(repoRoot, 'apps/web/dist'), path.join(distDir, 'web'), { recursive: true })
await cp(
  path.join(repoRoot, 'apps/server/src/db/migrations'),
  path.join(distDir, 'server/migrations'),
  { recursive: true }
)
// nbcli.mjs is spawned as `node <cwd>/packages/nbcli/nbcli.mjs` and has no
// external deps, so a plain copy is enough.
await mkdir(path.join(distDir, 'packages/nbcli'), { recursive: true })
await cp(
  path.join(repoRoot, 'packages/nbcli/nbcli.mjs'),
  path.join(distDir, 'packages/nbcli/nbcli.mjs')
)

console.log(`runcell-science bundle ready at ${path.relative(repoRoot, distDir)}`)
