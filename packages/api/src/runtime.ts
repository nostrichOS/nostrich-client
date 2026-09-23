import { DEFAULT_RELAYS, tryNormalizeRelayUrl } from '@nostrich/nostr'
import type { RelayUrl } from '@nostrich/nostr'
import { writeSync } from 'node:fs'

/** Shared worker runtime: logging, bounded concurrency, and a cache with a memory. */

// --------------------------------------------------------------------------- Logging.

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** One JSON object per line, straight to the container log. */
export function log(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
  if (level === 'debug' && process.env['LOG_DEBUG'] !== '1') return
  const line = JSON.stringify({ ts: new Date().toISOString(), level, service: 'push', message, ...fields })
  if (level === 'error' || level === 'warn') console.error(line)
  else console.log(line)
}

/** A log line that survives the process ending on the very next statement. */
export function logSync(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, service: 'push', message, ...fields })
  try {
    writeSync(level === 'error' || level === 'warn' ? 2 : 1, line + '\n')
  } catch {
    // A closed or full pipe must not turn a diagnosable crash into an undiagnosable one.
  }
}

export function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return String(err)
}

// --------------------------------------------------------------------------- Small.

export function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (raw === undefined || raw === '') return fallback
  /* THE WHOLE STRING, not a numeric prefix. */
  if (!/^\d+$/.test(raw)) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size))
  return out
}

export function parseRelays(raw: string | undefined): RelayUrl[] {
  const urls = (raw ?? '')
    .split(',')
    .map(entry => tryNormalizeRelayUrl(entry.trim()))
    .filter((url): url is RelayUrl => url !== undefined)
  return urls.length > 0 ? [...new Set(urls)] : [...DEFAULT_RELAYS]
}

/** Bounded concurrency plus a drain, so shutdown can wait for in-flight sends. */
export class Limiter {
  private active = 0
  private readonly waiting: Array<() => void> = []
  private readonly running = new Set<Promise<void>>()

  constructor(private readonly limit: number) {}

  get size(): number {
    return this.running.size
  }

  run(task: () => Promise<void>): void {
    const wrapped = (async () => {
      await this.acquire()
      try {
        await task()
      } catch (err) {
        // A single bad event must never take the worker down.
        log('error', 'queued task failed', { error: messageOf(err) })
      } finally {
        this.release()
      }
    })()
    this.running.add(wrapped)
    void wrapped.then(() => {
      this.running.delete(wrapped)
    })
  }

  async drain(): Promise<void> {
    while (this.running.size > 0) await Promise.all([...this.running])
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1
      return Promise.resolve()
    }
    return new Promise<void>(resolve => {
      this.waiting.push(() => {
        this.active += 1
        resolve()
      })
    })
  }

  private release(): void {
    this.active -= 1
    const next = this.waiting.shift()
    if (next !== undefined) next()
  }
}

/** Capped, TTL'd, with in-flight coalescing so a hot pubkey is fetched. */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; at: number }>()
  private readonly inflight = new Map<string, Promise<V>>()

  constructor(
    private readonly ttlMs: number,
    private readonly cap: number,
    private readonly load: (key: string) => Promise<V>,
    /** Per-value lifetime. */
    private readonly ttlFor?: (value: V) => number,
  ) {}

  async get(key: string): Promise<V> {
    const now = Date.now()
    const hit = this.entries.get(key)
    if (hit !== undefined && now - hit.at < (this.ttlFor?.(hit.value) ?? this.ttlMs)) return hit.value

    const pending = this.inflight.get(key)
    if (pending !== undefined) return pending

    const promise = this.load(key)
    this.inflight.set(key, promise)
    try {
      const value = await promise
      this.store(key, value, Date.now())
      return value
    } finally {
      this.inflight.delete(key)
    }
  }

  private store(key: string, value: V, at: number): void {
    this.entries.delete(key)
    this.entries.set(key, { value, at })
    if (this.entries.size > this.cap) {
      const oldest = this.entries.keys().next().value
      if (oldest !== undefined) this.entries.delete(oldest)
    }
  }
}

