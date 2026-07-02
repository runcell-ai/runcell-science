import { probeCodexCapabilities } from '../runtime/providers/codex/capability-probe'

async function main(): Promise<void> {
  const cwd = process.argv[2] ?? process.cwd()
  const report = await probeCodexCapabilities(cwd)
  console.log(JSON.stringify(report, null, 2))

  if (!report.initialized) {
    process.exitCode = 1
  }
}

void main()
