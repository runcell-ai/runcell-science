import { EventEmitter } from 'node:events'

import type { RuntimeSseEvent } from '@open-science/contracts'

type SessionEventListener = (event: RuntimeSseEvent) => void

export class SessionEventBus {
  private readonly emitter = new EventEmitter()

  constructor() {
    this.emitter.setMaxListeners(0)
  }

  publish(event: RuntimeSseEvent): void {
    this.emitter.emit(event.sessionId, event)
  }

  subscribe(sessionId: string, listener: SessionEventListener): () => void {
    this.emitter.on(sessionId, listener)

    return () => {
      this.emitter.off(sessionId, listener)
    }
  }
}

export const sessionEventBus = new SessionEventBus()
