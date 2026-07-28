export class ProviderRpcError extends Error {
  constructor(
    message: string,
    readonly code: number | string,
    readonly data?: unknown
  ) {
    super(message)
    this.name = 'ProviderRpcError'
  }
}
