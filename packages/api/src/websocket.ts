import { useWebSocketImplementation } from 'nostr-tools/pool'

/** Give nostr-tools a WebSocket, because this container does not have one. */
export function installWebSocket(): void {
  if (typeof globalThis.WebSocket === 'function') return
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ws = require('ws') as { new (...args: never[]): WsInstance }
  const safe = survivesAnUnreachableRelay(ws)
  useWebSocketImplementation(safe)
  ;(globalThis as { WebSocket?: unknown }).WebSocket = safe
}

interface WsInstance {
  on(event: string, listener: (...args: unknown[]) => void): unknown
}

/** A relay that does not answer must not be able to kill this process. */
function survivesAnUnreachableRelay<T extends { new (...args: never[]): WsInstance }>(impl: T): T {
  return new Proxy(impl, {
    construct(target, args, newTarget) {
      const socket = Reflect.construct(target, args, newTarget) as WsInstance
      socket.on('error', () => {})
      return socket as object
    },
  })
}
