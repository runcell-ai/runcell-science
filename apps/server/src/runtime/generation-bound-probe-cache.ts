export interface CancelableProbe<T> {
  promise: Promise<T>
  cancel(): void
}

interface InflightProbe<T> extends CancelableProbe<T> {
  generation: number
}

/**
 * Small stale-result guard for subprocess-backed catalogs. Configuration
 * changes advance the generation, cancel the old subprocess, and prevent a
 * late old promise from writing either cache or current in-flight state.
 */
export class GenerationBoundProbeCache<T> {
  private generation = 0
  private cached: { value: T; fetchedAt: number } | null = null
  private inflight: InflightProbe<T> | null = null

  get(
    ttlMs: number,
    createProbe: () => CancelableProbe<T>,
    now: () => number = Date.now
  ): Promise<T> {
    if (this.cached && now() - this.cached.fetchedAt < ttlMs) {
      return Promise.resolve(this.cached.value)
    }
    if (this.inflight?.generation === this.generation) {
      return this.inflight.promise
    }

    const generation = this.generation
    let created: CancelableProbe<T>
    try {
      created = createProbe()
    } catch (error) {
      return Promise.reject(error)
    }

    let promise: Promise<T>
    promise = created.promise
      .then((value) => {
        if (generation === this.generation) {
          this.cached = { value, fetchedAt: now() }
        }
        return value
      })
      .finally(() => {
        if (this.inflight?.promise === promise) {
          this.inflight = null
        }
      })

    this.inflight = {
      generation,
      promise,
      cancel: created.cancel
    }
    return promise
  }

  clear(): void {
    this.generation += 1
    this.cached = null
    const old = this.inflight
    this.inflight = null
    old?.cancel()
  }
}
