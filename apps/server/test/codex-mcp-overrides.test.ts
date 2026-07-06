import assert from 'node:assert/strict'
import test from 'node:test'

import { buildCodexMcpEnvOverrides } from '../src/runtime/providers/codex/codex-runtime'

test('Codex MCP env overrides are emitted as map entries, not a JSON string', () => {
  const overrides = buildCodexMcpEnvOverrides('ketcher-chemistry', {
    OPEN_SCIENCE_API_URL: 'http://127.0.0.1:27184',
    OPEN_SCIENCE_SESSION_ID: 'session-test'
  })

  assert.deepEqual(overrides, [
    '-c',
    'mcp_servers.ketcher-chemistry.env.OPEN_SCIENCE_API_URL="http://127.0.0.1:27184"',
    '-c',
    'mcp_servers.ketcher-chemistry.env.OPEN_SCIENCE_SESSION_ID="session-test"'
  ])
  assert.ok(!overrides.some((entry) => entry.includes('mcp_servers.ketcher-chemistry.env={')))
})
