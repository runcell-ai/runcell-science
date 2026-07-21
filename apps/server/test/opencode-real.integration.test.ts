import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const binaryPath = process.env.OPENCODE_TEST_BINARY?.trim()
const sqlitePath = path.join(os.tmpdir(), `open-science-opencode-real-${process.pid}.sqlite`)
const checkpointPath = path.join(os.tmpdir(), `open-science-opencode-real-checkpoints-${process.pid}.git`)
process.env.SQLITE_PATH = sqlitePath
process.env.CHECKPOINT_GIT_DIR = checkpointPath

test(
  'real OpenCode CLI enforces auth and completes a model-backed SDK/SSE turn',
  { skip: binaryPath ? false : 'set OPENCODE_TEST_BINARY to run the real CLI acceptance test' },
  async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'open-science-opencode-real-'))
    process.env.OPENCODE_BINARY_PATH = binaryPath
    process.env.LOG_LEVEL = 'silent'

    const [{ connectOpenCodeServer, assertOpenCodeCompatibility }] = await Promise.all([
      import('../src/runtime/providers/opencode/opencode-server')
    ])

    const connection = await connectOpenCodeServer({ directory, sessionId: 'real-acceptance' })
    const abortController = new AbortController()
    let providerSessionId: string | null = null
    let productRuntime: { dispose(): Promise<void>; resetSession(sessionId: string): void } | null = null
    let closeProductDb: (() => void) | null = null

    try {
      assert.equal(connection.owned, true)
      assert.match(connection.url, /^http:\/\/127\.0\.0\.1:/)
      assert.ok(connection.password, 'managed servers must use a random password')

      const unauthenticated = await fetch(new URL('/global/health', connection.url))
      assert.equal(unauthenticated.status, 401)

      const client = connection.createClient(directory)
      assert.equal(await assertOpenCodeCompatibility(client), '1.18.4')

      const inventory = (await client.provider.list({ directory })).data
      assert.ok(inventory, 'expected OpenCode provider inventory')
      const connected = inventory.all.filter((provider) => inventory.connected.includes(provider.id))
      const provider = connected.find((entry) => entry.id === 'opencode') ?? connected[0]
      assert.ok(provider, 'expected at least one connected OpenCode provider')
      const models = Object.values(provider.models).filter((model) => model.status !== 'deprecated')
      const model = models.find((entry) => entry.id.includes('free')) ?? models[0]
      assert.ok(model, `expected at least one model for connected provider ${provider.id}`)

      const created = await client.session.create({
        directory,
        model: { providerID: provider.id, id: model.id },
        permission: [{ permission: '*', pattern: '*', action: 'allow' }]
      })
      assert.ok(created.data)
      providerSessionId = created.data.id

      const subscription = await client.event.subscribe(
        { directory },
        { signal: abortController.signal }
      )
      let sawAssistantPart = false
      const turnSettled = new Promise<void>((resolve, reject) => {
        void (async () => {
          try {
            for await (const event of subscription.stream) {
              if (!('properties' in event) || event.properties.sessionID !== providerSessionId) continue
              if (event.type === 'message.part.updated' && event.properties.part.type === 'text') {
                sawAssistantPart = true
              }
              if (event.type === 'session.error') {
                reject(new Error(`OpenCode model turn failed: ${JSON.stringify(event.properties.error)}`))
                return
              }
              if (
                event.type === 'session.idle' ||
                (event.type === 'session.status' && event.properties.status.type === 'idle')
              ) {
                resolve()
                return
              }
            }
            reject(new Error('OpenCode event stream ended before the turn settled.'))
          } catch (error) {
            if (!abortController.signal.aborted) reject(error)
          }
        })()
      })

      await client.session.promptAsync({
        sessionID: providerSessionId,
        directory,
        model: { providerID: provider.id, modelID: model.id },
        system: 'Return only the exact token requested by the user. Do not use tools.',
        parts: [{ type: 'text', text: 'Reply with exactly OPENCODE_OK' }]
      })
      await Promise.race([
        turnSettled,
        new Promise<never>((_, reject) => {
          const timer = setTimeout(() => reject(new Error('Timed out waiting for the real OpenCode turn.')), 120_000)
          timer.unref()
        })
      ])

      const messages = (await client.session.messages({ sessionID: providerSessionId, directory })).data ?? []
      const assistantText = messages
        .filter((message) => message.info.role === 'assistant')
        .flatMap((message) => message.parts)
        .filter((part): part is Extract<(typeof messages)[number]['parts'][number], { type: 'text' }> => part.type === 'text')
        .map((part) => part.text)
        .join('')

      assert.equal(sawAssistantPart, true)
      assert.ok(assistantText.trim().length > 0, 'expected non-empty assistant text from the real model')

      const [{ runMigrations }, dbModule, { agentSessionService }, { OpenCodeRuntime }] = await Promise.all([
        import('../src/db/migrate'),
        import('../src/db/connection'),
        import('../src/services'),
        import('../src/runtime/providers/opencode/opencode-runtime')
      ])
      closeProductDb = dbModule.closeDb
      await runMigrations()

      const pending = agentSessionService.createPendingSessionForInitialMessage({
        provider: 'opencode',
        cwd: directory,
        initialMessage: 'Reply with a short greeting and do not use tools.',
        model: `${provider.id}/${model.id}`,
        runtimeMode: 'full_access'
      })
      const turn = pending.detail.turns[0]
      const message = pending.detail.messages[0]
      assert.ok(turn && message)

      const runtime = new OpenCodeRuntime()
      productRuntime = runtime
      await runtime.startInitialTurn({ session: pending.detail.session, turn, message })
      const deadline = Date.now() + 120_000
      let completed = agentSessionService.getSessionDetail(pending.sessionId)
      while (completed?.turns[0]?.status !== 'completed' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50))
        completed = agentSessionService.getSessionDetail(pending.sessionId)
      }

      assert.equal(completed?.turns[0]?.status, 'completed')
      assert.equal(completed?.session.status, 'ready')
      assert.ok(completed?.session.providerSessionId)
      assert.ok(completed?.messages.some((entry) => entry.role === 'assistant' && entry.text.trim().length > 0))

      const firstProviderSessionId = completed?.session.providerSessionId
      runtime.resetSession(pending.sessionId)
      const followup = agentSessionService.startFollowupTurn({
        sessionId: pending.sessionId,
        message: 'Reply with another short greeting and do not use tools.'
      })
      const followupDetail = agentSessionService.getSessionDetail(pending.sessionId)
      const followupMessage = followupDetail?.messages.find(
        (entry) => entry.turnId === followup.id && entry.role === 'user'
      )
      assert.ok(followupDetail && followupMessage)
      await runtime.startTurn({ session: followupDetail.session, turn: followup, message: followupMessage })

      const followupDeadline = Date.now() + 120_000
      let resumed = agentSessionService.getSessionDetail(pending.sessionId)
      while (resumed?.turns.find((entry) => entry.id === followup.id)?.status !== 'completed' && Date.now() < followupDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 50))
        resumed = agentSessionService.getSessionDetail(pending.sessionId)
      }

      assert.equal(resumed?.turns.find((entry) => entry.id === followup.id)?.status, 'completed')
      assert.equal(resumed?.session.providerSessionId, firstProviderSessionId)
      assert.ok((resumed?.messages.filter((entry) => entry.role === 'assistant').length ?? 0) >= 2)

      const raceTurn = agentSessionService.startFollowupTurn({
        sessionId: pending.sessionId,
        message: 'Reply with exactly INTERRUPT_RACE_OK and do not use tools.'
      })
      const raceDetail = agentSessionService.getSessionDetail(pending.sessionId)
      const raceMessage = raceDetail?.messages.find(
        (entry) => entry.turnId === raceTurn.id && entry.role === 'user'
      )
      assert.ok(raceDetail && raceMessage)
      await runtime.startTurn({ session: raceDetail.session, turn: raceTurn, message: raceMessage })

      type InternalRuntimeState = {
        client: { session: { abort: (input: unknown, options?: unknown) => Promise<unknown> } }
        deferredInterruptTerminal: unknown
      }
      const runtimeState = (runtime as unknown as { sessions: Map<string, InternalRuntimeState> }).sessions.get(
        pending.sessionId
      )
      assert.ok(runtimeState)
      const originalAbort = runtimeState.client.session.abort
      runtimeState.client.session.abort = async () => {
        const terminalDeadline = Date.now() + 120_000
        while (!runtimeState.deferredInterruptTerminal && Date.now() < terminalDeadline) {
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
        assert.ok(runtimeState.deferredInterruptTerminal, 'expected a terminal event during the simulated abort race')
        throw new Error('simulated abort transport failure')
      }
      try {
        await assert.rejects(runtime.interrupt({ session: raceDetail.session }), /simulated abort transport failure/)
      } finally {
        runtimeState.client.session.abort = originalAbort
      }

      const raceDeadline = Date.now() + 5_000
      let raceCompleted = agentSessionService.getSessionDetail(pending.sessionId)
      while (raceCompleted?.turns.find((entry) => entry.id === raceTurn.id)?.status !== 'completed' && Date.now() < raceDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 25))
        raceCompleted = agentSessionService.getSessionDetail(pending.sessionId)
      }
      assert.equal(raceCompleted?.turns.find((entry) => entry.id === raceTurn.id)?.status, 'completed')
      assert.ok(
        raceCompleted?.messages.some(
          (entry) => entry.turnId === raceTurn.id && entry.role === 'assistant' && entry.text.trim().length > 0
        ),
        'expected buffered assistant output to be replayed before completion'
      )

      const interruptedTurn = agentSessionService.startFollowupTurn({
        sessionId: pending.sessionId,
        message: 'Write a detailed 2000-word essay, without using tools.'
      })
      const interruptDetail = agentSessionService.getSessionDetail(pending.sessionId)
      const interruptMessage = interruptDetail?.messages.find(
        (entry) => entry.turnId === interruptedTurn.id && entry.role === 'user'
      )
      assert.ok(interruptDetail && interruptMessage)
      await runtime.startTurn({
        session: interruptDetail.session,
        turn: interruptedTurn,
        message: interruptMessage
      })
      await runtime.interrupt({ session: interruptDetail.session })
      const interrupted = agentSessionService.interruptRunningTurn(pending.sessionId)
      assert.equal(interrupted.interrupted, true)
      assert.equal(interrupted.turn?.id, interruptedTurn.id)
      assert.equal(interrupted.turn?.status, 'interrupted')
      assert.equal(
        agentSessionService.getSessionDetail(pending.sessionId)?.turns.find((entry) => entry.id === interruptedTurn.id)?.status,
        'interrupted'
      )
    } finally {
      abortController.abort()
      await productRuntime?.dispose()
      closeProductDb?.()
      await connection.dispose()
      rmSync(directory, { recursive: true, force: true })
      rmSync(sqlitePath, { force: true })
      rmSync(checkpointPath, { recursive: true, force: true })
    }
  }
)
