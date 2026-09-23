/** The trending builder's process. */
import { installWebSocket } from '../websocket'
import { prisma } from '../db'
import { log, messageOf } from '../runtime'
import { TrendingBuilder } from './builder'

/** Keeps the event loop alive between builds, so the process does not exit on an idle. */
const HEARTBEAT_MS = 60_000

function firstSignal(): Promise<string> {
  return new Promise<string>(resolve => {
    const heartbeat = setInterval(() => {}, HEARTBEAT_MS)
    const done = (signal: string) => (): void => {
      clearInterval(heartbeat)
      resolve(signal)
    }
    process.once('SIGTERM', done('SIGTERM'))
    process.once('SIGINT', done('SIGINT'))
  })
}

async function main(): Promise<void> {
  /* FIRST, before anything opens a socket: Node 20 has no global WebSocket. */
  installWebSocket()
  process.on('unhandledRejection', reason => {
    log('error', 'unhandled rejection', { error: messageOf(reason) })
  })

  if (process.env['TRENDING_ENABLED'] === 'false') {
    log('info', 'trending builder disabled by TRENDING_ENABLED')
    return
  }

  const builder = new TrendingBuilder()
  builder.start()
  log('info', 'trending builder started')

  const signal = await firstSignal()
  log('info', 'shutting down', { signal })
  builder.stop()
  await prisma.$disconnect()
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    log('error', 'trending worker failed', { error: messageOf(err) })
    process.exit(1)
  },
)
