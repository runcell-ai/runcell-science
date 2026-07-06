#!/usr/bin/env node
import { bundledScienceConnectors } from './registry.js'
import { getConnectorModule } from './connectors/index.js'
import { runStdioServer } from './mcp/create-server.js'

async function main() {
  const [, , command, name] = process.argv

  if (command === 'list') {
    process.stdout.write(`${JSON.stringify({ connectors: bundledScienceConnectors }, null, 2)}\n`)
    return
  }

  if (command !== 'connector' || !name) {
    process.stderr.write('Usage: open-science-science-connector list | connector <name>\n')
    process.exitCode = 2
    return
  }

  const connector = getConnectorModule(name)
  if (!connector) {
    process.stderr.write(`Unknown science connector: ${name}\n`)
    process.exitCode = 2
    return
  }

  await runStdioServer(connector)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
