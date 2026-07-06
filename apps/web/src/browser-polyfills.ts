type BrowserProcess = {
  env: Record<string, string | undefined>
  nextTick: (callback: (...args: unknown[]) => void, ...args: unknown[]) => void
  cwd: () => string
  pid: number
  stderr: { isTTY: false; columns: number; getColorDepth: () => number }
  emitWarning: (message: unknown) => void
}

const globals = globalThis as typeof globalThis & {
  global?: typeof globalThis
  process?: Partial<BrowserProcess>
}

globals.global = globals.global ?? globalThis
const existingProcess = globals.process ?? {}

globals.process = {
  ...existingProcess,
  env: {
    ...(existingProcess.env ?? {})
  },
  nextTick:
    existingProcess.nextTick ??
    ((callback, ...args) => {
      queueMicrotask(() => callback(...args))
    }),
  cwd: existingProcess.cwd ?? (() => '/'),
  pid: existingProcess.pid ?? 0,
  stderr: existingProcess.stderr ?? {
    isTTY: false,
    columns: 80,
    getColorDepth() {
      return 1
    }
  },
  emitWarning: existingProcess.emitWarning ?? ((message) => console.warn(message))
}
