import { SimplePool } from 'nostr-tools/pool'

import type {
  CountOptions,
  Filter,
  NostrEvent,
  Pool,
  PublishResult,
  QueryOutcome,
  RelayPolicy,
  RelayStatus,
  RelayUrl,
  SubscribeParams,
  SubscriptionHandle,
  QueryOptions,
} from './types'
import { isPermanentRefusal } from './closed-reason'
import {
  DEFAULT_RELAY_ENTRIES,
  normalizeRelayUrls,
  tryNormalizeRelayUrl,
  type RelayEntry,
} from './relays'

/** The slice of nostr-tools we actually depend. */
export interface UnderlyingSubscription {
  close(reason?: string): void
}

export interface UnderlyingSubscribeParams {
  onevent?: (event: NostrEvent) => void
  oneose?: () => void
  onclose?: (reason: string) => void
  alreadyHaveEvent?: (id: string) => boolean
  eoseTimeout?: number
}

export interface UnderlyingRelay {
  readonly url: string
  readonly connected: boolean
  subscribe(filters: Filter[], params: UnderlyingSubscribeParams): UnderlyingSubscription
  publish(event: NostrEvent): Promise<string>
  /** NIP-45. Optional: most relays do not implement it and the caller must cope. */
  count?(filters: Filter[], params: { id?: string | null }): Promise<number>
  close(): void
}

export interface UnderlyingPool {
  ensureRelay(url: string, params?: { connectionTimeout?: number }): Promise<UnderlyingRelay>
  close(relays: string[]): void
}

export interface NostrichPoolOptions {
  /** Initial relay set. */
  relays?: readonly RelayEntry[]
  /** Injected by tests. */
  underlying?: UnderlyingPool
  /** Per-relay ceiling on the wait for EOSE before that relay is written off. */
  eoseTimeoutMs?: number
  connectTimeoutMs?: number
  publishTimeoutMs?: number
  /** Default for `query()`'s third argument. */
  queryTimeoutMs?: number
  /** How long the stream may be quiet, after at least one relay has answered. */
  queryGraceMs?: number
  /** Ids remembered per subscription for dedup. */
  seenCap?: number
  /** Concurrent REQs this pool will hold open on any ONE relay, excluding `live` ones. */
  maxSubsPerRelay?: number
  reconnectBaseMs?: number
  reconnectMaxMs?: number
  /** Injectable so the backoff jitter is deterministic under test. */
  random?: () => number
  now?: () => number
  /** Events dropped on arrival, before any caller sees them. */
  reject?: (event: NostrEvent) => boolean
}

const DEFAULT_EOSE_TIMEOUT_MS = 5_000
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000
const DEFAULT_PUBLISH_TIMEOUT_MS = 10_000
const DEFAULT_QUERY_TIMEOUT_MS = 8_000
const DEFAULT_SEEN_CAP = 10_000
/** See `NostrichPoolOptions.maxSubsPerRelay`. */
const DEFAULT_MAX_SUBS_PER_RELAY = 10
/** Quiet time before a query stops waiting for the relays that have not finished. */
const DEFAULT_QUERY_GRACE_MS = 1_000
/** How long a relay that took a COUNT and never answered is passed. */
const COUNT_SLOW_SKIP_MS = 60_000

const DEFAULT_RECONNECT_BASE_MS = 1_000
const DEFAULT_RECONNECT_MAX_MS = 5 * 60_000

/** Bounded set of event ids, oldest-touched evicted first. */
export class SeenIds {
  private readonly ids = new Map<string, true>()

  constructor(private readonly cap: number) {}

  /** Records `id` and returns true only the first time it is seen. */
  add(id: string): boolean {
    if (this.ids.delete(id)) {
      this.ids.set(id, true)
      return false
    }
    this.ids.set(id, true)
    if (this.ids.size > this.cap) {
      const oldest = this.ids.keys().next().value
      if (oldest !== undefined) this.ids.delete(oldest)
    }
    return true
  }

  has(id: string): boolean {
    return this.ids.has(id)
  }

  get size(): number {
    return this.ids.size
  }
}

interface RelayRecord {
  readonly url: RelayUrl
  policy: RelayPolicy
  /** False for relays reached only through an explicit `relays` argument. */
  configured: boolean
  status: RelayStatus
  /** Consecutive failures, driving the shared backoff for this relay. */
  failures: number
  /** Epoch ms before which this relay should not be dialled again. */
  nextAttemptAt: number
  /** Whether this relay answers NIP-45 `COUNT`. */
  countsSupported: boolean | undefined
  /** Epoch ms until which this relay is passed over by opt-in callers. */
  countSlowUntil: number | undefined
  /** REQs currently open on this relay, and the ones waiting for a slot. */
  active: Set<RelayLeg>
  waiting: Array<{ sub: PoolSubscription; leg: RelayLeg }>
}

/** One subscription's attachment to one relay. */
interface RelayLeg {
  readonly url: RelayUrl
  sub?: UnderlyingSubscription
  eosed: boolean
  /** Set once we deliberately let this leg go. */
  detached: boolean
  eoseTimer?: ReturnType<typeof setTimeout>
  reconnectTimer?: ReturnType<typeof setTimeout>
  /** When the REQ went out, for the latency shown on the relay screen. */
  sentAt: number
  /** Holding a slot on its relay. Cleared when the slot is given back. */
  admitted: boolean
  /** Whether that slot is one of the ceiling's. */
  counted: boolean
  /** Waiting for a slot. */
  waiting: boolean
}

class PoolSubscription implements SubscriptionHandle {
  readonly legs = new Map<RelayUrl, RelayLeg>()
  readonly seen: SeenIds
  eoseFired = false
  closed = false

  constructor(
    readonly params: SubscribeParams,
    /** True when the caller named its relays, so `setRelays` must leave it alone. */
    readonly pinnedRelays: boolean,
    seenCap: number,
    private readonly onClose: (sub: PoolSubscription) => void,
  ) {
    this.seen = new SeenIds(seenCap)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.onClose(this)
  }
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return String(err)
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      err => {
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(messageOf(err)))
      },
    )
  })
}

export class NostrichPool implements Pool {
  private readonly underlying: UnderlyingPool
  private readonly records = new Map<RelayUrl, RelayRecord>()
  private readonly subs = new Set<PoolSubscription>()
  private disposed = false

  private readonly eoseTimeoutMs: number
  private readonly connectTimeoutMs: number
  private readonly publishTimeoutMs: number
  private readonly queryTimeoutMs: number
  private readonly queryGraceMs: number
  private readonly seenCap: number
  private readonly maxSubsPerRelay: number
  private readonly reconnectBaseMs: number
  private readonly reconnectMaxMs: number
  private readonly random: () => number
  private readonly now: () => number
  /** See `NostrichPoolOptions.reject`. */
  private readonly reject: ((event: NostrEvent) => boolean) | undefined

  constructor(options: NostrichPoolOptions = {}) {
    // SimplePool matches UnderlyingPool structurally.
    this.underlying = options.underlying ?? (new SimplePool() as unknown as UnderlyingPool)
    this.eoseTimeoutMs = options.eoseTimeoutMs ?? DEFAULT_EOSE_TIMEOUT_MS
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
    this.publishTimeoutMs = options.publishTimeoutMs ?? DEFAULT_PUBLISH_TIMEOUT_MS
    this.queryTimeoutMs = options.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS
    this.queryGraceMs = options.queryGraceMs ?? DEFAULT_QUERY_GRACE_MS
    this.seenCap = options.seenCap ?? DEFAULT_SEEN_CAP
    this.maxSubsPerRelay = options.maxSubsPerRelay ?? DEFAULT_MAX_SUBS_PER_RELAY
    this.reconnectBaseMs = options.reconnectBaseMs ?? DEFAULT_RECONNECT_BASE_MS
    this.reconnectMaxMs = options.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS
    this.random = options.random ?? Math.random
    this.now = options.now ?? Date.now
    this.reject = options.reject

    this.setRelays(
      options.relays !== undefined
        ? [...options.relays]
        : // Policies included, the default set is not uniform.
          DEFAULT_RELAY_ENTRIES.map(entry => ({ url: entry.url, policy: { ...entry.policy } })),
    )
  }

  // ------------------------------------------------------------------------- Relay set.

  setRelays(relays: Array<{ url: RelayUrl; policy: RelayPolicy }>): void {
    if (this.disposed) return

    const next = new Map<RelayUrl, RelayPolicy>()
    for (const entry of relays) {
      const url = tryNormalizeRelayUrl(entry.url)
      if (url === undefined) continue
      const prev = next.get(url)
      next.set(
        url,
        prev === undefined
          ? { read: entry.policy.read, write: entry.policy.write }
          : { read: prev.read || entry.policy.read, write: prev.write || entry.policy.write },
      )
    }

    const dropped: RelayUrl[] = []
    for (const [url, record] of this.records) {
      const policy = next.get(url)
      if (policy === undefined) {
        if (record.configured) {
          this.records.delete(url)
          dropped.push(url)
        }
        continue
      }
      record.policy = policy
      record.configured = true
    }
    for (const [url, policy] of next) {
      if (!this.records.has(url)) this.records.set(url, this.newRecord(url, policy, true))
    }

    // Subscriptions that took the pool default have to follow the user editing.
    const readUrls = this.readRelayUrls()
    for (const sub of this.subs) {
      if (sub.pinnedRelays || sub.closed) continue
      for (const [url, leg] of sub.legs) {
        if (readUrls.includes(url)) continue
        this.closeLeg(leg)
        sub.legs.delete(url)
      }
      for (const url of readUrls) this.openLeg(sub, url)
      // Removing the last relay we were still waiting on can complete the EOSE.
      this.maybeEose(sub)
    }

    const stillUsed = new Set<RelayUrl>()
    for (const sub of this.subs) {
      if (sub.closed) continue
      for (const url of sub.legs.keys()) stillUsed.add(url)
    }
    const toClose = dropped.filter(url => !stillUsed.has(url))
    if (toClose.length > 0) this.underlying.close(toClose)
  }

  /** The reader's OWN relays, and only. */
  status(): RelayStatus[] {
    return [...this.records.values()]
      .filter(record => record.configured)
      .map(record => ({ ...record.status }))
  }

  // -------------------------------------------------------------------------.

  subscribe(params: SubscribeParams): SubscriptionHandle {
    if (this.disposed) return { close() {} }

    const pinned = params.relays !== undefined
    const targets = pinned ? normalizeRelayUrls(params.relays ?? []) : this.readRelayUrls()

    const sub = new PoolSubscription(params, pinned, this.seenCap, s => this.teardown(s))
    this.subs.add(sub)

    for (const url of targets) this.openLeg(sub, url)

    if (sub.legs.size === 0) {
      // Nothing to wait on, but onEose still has to fire exactly.
      setTimeout(() => this.fireEose(sub), 0)
    }
    return sub
  }

  /** NIP-45 COUNT: how many events match, without transferring any of them. */
  async count(
    filters: Filter[],
    relays?: RelayUrl[],
    timeoutMs?: number,
    options?: CountOptions,
  ): Promise<number | undefined> {
    if (this.disposed) return undefined
    const targets = relays !== undefined ? normalizeRelayUrls(relays) : this.readRelayUrls()
    const budget = timeoutMs ?? this.queryTimeoutMs

    /* Relays already known not to answer COUNT are not asked again. */
    const now = Date.now()
    const answering = targets.filter(url => {
      const record = this.records.get(url)
      if (record?.countsSupported === false) return false
      /* The RECENTLY SILENT are skipped only for callers that asked to skip them. */
      if (options?.skipUnresponsive !== true) return true
      return (record?.countSlowUntil ?? 0) <= now
    })
    const asking = answering.length > 0 ? answering : targets

    const answers = await Promise.all(
      asking.map(async url => {
        const record = this.ensureRecord(url)
        try {
          const relay = await this.underlying.ensureRelay(url, { connectionTimeout: this.connectTimeoutMs })
          // Absent on relays that do not implement it, which is most of them.
          if (typeof relay.count !== 'function') {
            record.countsSupported = false
            return undefined
          }
          const counted = await withTimeout(relay.count(filters, { id: null }), budget, `count timed out on ${url}`)
          if (typeof counted === 'number' && Number.isFinite(counted) && counted >= 0) {
            record.countsSupported = true
            return counted
          }
          // Answered, but not with a number.
          record.countsSupported = false
          return undefined
        } catch (err) {
          /* NOTHING IS WRITTEN OFF ON A TIMEOUT. */
          if (messageOf(err).includes('count timed out')) {
            record.countSlowUntil = Date.now() + COUNT_SLOW_SKIP_MS
          }
          return undefined
        }
      }),
    )

    const known = answers.filter((value): value is number => value !== undefined)
    return known.length === 0 ? undefined : Math.max(...known)
  }

  async query(
    filters: Filter[],
    relays?: RelayUrl[],
    timeoutMs: number = this.queryTimeoutMs,
    options?: QueryOptions,
  ): Promise<NostrEvent[]> {
    const outcome = await this.queryWithStatus(filters, relays, timeoutMs, options)
    return outcome.events
  }

  /** A query that also reports whether anybody replied. */
  async queryWithStatus(
    filters: Filter[],
    relays?: RelayUrl[],
    timeoutMs: number = this.queryTimeoutMs,
    options?: QueryOptions,
  ): Promise<QueryOutcome> {
    const attempted = (
      relays !== undefined ? normalizeRelayUrls(relays) : this.readRelayUrls()
    ).length
    const grace = options?.graceMs ?? this.queryGraceMs

    return new Promise<QueryOutcome>(resolve => {
      const events: NostrEvent[] = []
      const answered = new Set<RelayUrl>()
      let handle: SubscriptionHandle | undefined
      let settled = false
      let quiet: ReturnType<typeof setTimeout> | undefined

      const finish = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (quiet !== undefined) clearTimeout(quiet)
        handle?.close()
        resolve({ events, answered: answered.size, attempted })
      }

      /** ONE SLOW RELAY NO LONGER HOLDS THE ANSWER. */
      const settleWhenQuiet = (): void => {
        if (grace <= 0 || answered.size === 0) return
        if (quiet !== undefined) clearTimeout(quiet)
        quiet = setTimeout(finish, grace)
      }

      // Belt to the per-relay EOSE timeout's braces: this one also bounds a relay.
      const timer = setTimeout(finish, timeoutMs)

      handle = this.subscribe({
        filters,
        ...(relays !== undefined ? { relays } : {}),
        onEvent: event => {
          events.push(event)
          /* Handed on IMMEDIATELY, before this query settles. */
          try {
            options?.onEvent?.(event)
          } catch {
            // A caller's bookkeeping is not this query's problem.
          }
          // Still flowing: whoever is sending gets more time.
          settleWhenQuiet()
        },
        onRelayEose: url => {
          answered.add(url)
          settleWhenQuiet()
        },
        onEose: finish,
        closeOnEose: true,
      })
      if (settled) handle.close()
    })
  }

  private openLeg(sub: PoolSubscription, url: RelayUrl): void {
    if (sub.closed || this.disposed || sub.legs.has(url)) return

    /* A HINTED RELAY THAT KEEPS REFUSING IS LEFT ALONE. */
    const known = this.records.get(url)
    if (known !== undefined && !known.configured && this.now() < known.nextAttemptAt) return

    const leg: RelayLeg = {
      url,
      eosed: false,
      detached: false,
      sentAt: this.now(),
      admitted: false,
      counted: false,
      waiting: false,
    }
    sub.legs.set(url, leg)
    this.ensureRecord(url)

    this.startEoseClock(sub, leg)
    void this.attach(sub, leg)
  }

  /** The EOSE deadline, started when the REQ can actually go out. */
  private startEoseClock(sub: PoolSubscription, leg: RelayLeg): void {
    if (leg.eoseTimer !== undefined || leg.eosed) return
    leg.eoseTimer = setTimeout(() => {
      leg.eoseTimer = undefined
      this.legEosed(sub, leg)
    }, this.eoseTimeoutMs)
  }

  private stopEoseClock(leg: RelayLeg): void {
    if (leg.eoseTimer === undefined) return
    clearTimeout(leg.eoseTimer)
    leg.eoseTimer = undefined
  }

  /** Take a slot on this relay, or join the queue. */
  private admit(sub: PoolSubscription, leg: RelayLeg, record: RelayRecord): boolean {
    if (leg.admitted) return true
    if (sub.params.live === true) {
      // Admitted and NOT counted: the ceiling exists to bound speculative work.
      leg.admitted = true
      leg.counted = false
      leg.waiting = false
      return true
    }
    if (record.active.size < this.maxSubsPerRelay) {
      leg.admitted = true
      leg.counted = true
      leg.waiting = false
      record.active.add(leg)
      return true
    }
    if (!leg.waiting) {
      leg.waiting = true
      // Its deadline restarts when it is admitted.
      this.stopEoseClock(leg)
      record.waiting.push({ sub, leg })
    }
    return false
  }

  /** Give the slot back and start whatever was waiting. */
  private release(leg: RelayLeg): void {
    const record = this.records.get(leg.url)
    if (record === undefined) return
    if (leg.admitted) {
      leg.admitted = false
      if (leg.counted) {
        leg.counted = false
        record.active.delete(leg)
      }
    }
    if (leg.waiting) {
      leg.waiting = false
      const at = record.waiting.findIndex(entry => entry.leg === leg)
      if (at !== -1) record.waiting.splice(at, 1)
    }
    this.pump(record)
  }

  private pump(record: RelayRecord): void {
    while (record.active.size < this.maxSubsPerRelay) {
      const next = record.waiting.shift()
      if (next === undefined) return
      next.leg.waiting = false
      if (next.sub.closed || next.leg.detached || this.disposed) continue
      this.startEoseClock(next.sub, next.leg)
      void this.attach(next.sub, next.leg)
    }
  }

  private async attach(sub: PoolSubscription, leg: RelayLeg): Promise<void> {
    if (sub.closed || this.disposed || leg.detached) return
    const record = this.ensureRecord(leg.url)
    // Before the socket is awaited, not after: a dozen legs all waiting on the same.
    if (!this.admit(sub, leg, record)) return
    if (record.status.state !== 'open') record.status.state = 'connecting'

    let relay: UnderlyingRelay
    try {
      relay = await this.underlying.ensureRelay(leg.url, { connectionTimeout: this.connectTimeoutMs })
    } catch (err) {
      record.status.state = 'failed'
      record.status.error = messageOf(err)
      this.legEosed(sub, leg)
      // The REQ never went out, so the slot it was holding belongs to whoever is next.
      this.release(leg)
      this.scheduleReattach(sub, leg)
      return
    }
    if (sub.closed || this.disposed || leg.detached) {
      this.release(leg)
      return
    }

    record.status.state = 'open'
    record.status.error = undefined
    record.failures = 0
    record.nextAttemptAt = 0
    leg.sentAt = this.now()

    try {
      leg.sub = relay.subscribe(sub.params.filters, {
        onevent: event => this.deliver(sub, leg, event),
        oneose: () => {
          record.status.latencyMs = Math.max(0, this.now() - leg.sentAt)
          // Here and nowhere else.
          sub.params.onRelayEose?.(leg.url)
          this.legEosed(sub, leg)
        },
        onclose: reason => this.legClosed(sub, leg, reason),
        // Lets the relay skip signature verification for events this subscription already.
        alreadyHaveEvent: id => sub.seen.has(id),
        eoseTimeout: this.eoseTimeoutMs,
      })
    } catch (err) {
      record.status.state = 'failed'
      record.status.error = messageOf(err)
      this.legEosed(sub, leg)
      this.release(leg)
      this.scheduleReattach(sub, leg)
    }
  }

  private deliver(sub: PoolSubscription, leg: RelayLeg, event: NostrEvent): void {
    if (sub.closed || leg.detached) return
    // The whole point of the pool: a note sitting on six relays arrives six times.
    if (!sub.seen.add(event.id)) return
    // Dropped here rather than by each caller.
    if (this.reject?.(event) === true) return
    sub.params.onEvent(event, leg.url)
  }

  private legEosed(sub: PoolSubscription, leg: RelayLeg): void {
    if (leg.eosed) return
    leg.eosed = true
    if (leg.eoseTimer !== undefined) {
      clearTimeout(leg.eoseTimer)
      leg.eoseTimer = undefined
    }
    this.maybeEose(sub)
  }

  private maybeEose(sub: PoolSubscription): void {
    if (sub.eoseFired || sub.closed) return
    for (const leg of sub.legs.values()) if (!leg.eosed) return
    this.fireEose(sub)
  }

  private fireEose(sub: PoolSubscription): void {
    if (sub.eoseFired || sub.closed) return
    sub.eoseFired = true
    sub.params.onEose?.()
    if (sub.params.closeOnEose === true) sub.close()
  }

  private legClosed(sub: PoolSubscription, leg: RelayLeg, reason: string): void {
    leg.sub = undefined
    if (sub.closed || this.disposed || leg.detached) return

    const record = this.ensureRecord(leg.url)
    if (record.status.state !== 'failed') {
      record.status.state = 'closed'
      record.status.error = reason === '' ? undefined : reason
    }
    // A relay that dropped mid-stream is not going to EOSE this REQ.
    this.legEosed(sub, leg)
    // Gone from the relay's point of view, so it is gone from our count of what is open.
    this.release(leg)

    /** A refusal ends this leg. */
    if (isPermanentRefusal(reason)) {
      leg.detached = true
      return
    }
    this.scheduleReattach(sub, leg)
  }

  private scheduleReattach(sub: PoolSubscription, leg: RelayLeg): void {
    if (sub.closed || this.disposed || leg.detached || leg.reconnectTimer !== undefined) return
    const record = this.ensureRecord(leg.url)
    const delay = this.backoffMs(record.failures)
    record.failures += 1
    // Remembered on the RECORD, so the next subscription to name this relay sees it too.
    record.nextAttemptAt = this.now() + delay
    leg.reconnectTimer = setTimeout(() => {
      leg.reconnectTimer = undefined
      void this.attach(sub, leg)
    }, delay)
  }

  /** Equal jitter: half the window is a deterministic floor, half is random. */
  private backoffMs(failures: number): number {
    // Without the random half, every client that was connected when a relay restarted.
    const ceiling = Math.min(this.reconnectMaxMs, this.reconnectBaseMs * 2 ** Math.min(failures, 20))
    return Math.round(ceiling / 2 + this.random() * (ceiling / 2))
  }

  private closeLeg(leg: RelayLeg): void {
    leg.detached = true
    // Released FIRST, so the queue starts its next leg in the same tick this one ends.
    this.release(leg)
    if (leg.eoseTimer !== undefined) clearTimeout(leg.eoseTimer)
    if (leg.reconnectTimer !== undefined) clearTimeout(leg.reconnectTimer)
    leg.eoseTimer = undefined
    leg.reconnectTimer = undefined
    try {
      leg.sub?.close()
    } catch {
      // The socket is already gone.
    }
    leg.sub = undefined
  }

  private teardown(sub: PoolSubscription): void {
    this.subs.delete(sub)
    for (const leg of sub.legs.values()) this.closeLeg(leg)
    sub.legs.clear()
  }

  // ------------------------------------------------------------------------- Publishing.

  async publish(event: NostrEvent, relays?: RelayUrl[]): Promise<PublishResult[]> {
    /** A RELAY MARKED READ-ONLY IS NEVER PUBLISHED. */
    const requested = relays !== undefined ? normalizeRelayUrls(relays) : this.writeRelayUrls()
    const targets = requested.filter(url => this.records.get(url)?.policy.write !== false)
    // Promise.all over branches that cannot reject: one relay refusing a note is routine.
    return Promise.all(targets.map(url => this.publishTo(event, url)))
  }

  /** Publish, answering the moment ONE relay accepts. */
  async publishFirstAccept(event: NostrEvent, relays?: RelayUrl[]): Promise<boolean> {
    const requested = relays !== undefined ? normalizeRelayUrls(relays) : this.writeRelayUrls()
    const targets = requested.filter(url => this.records.get(url)?.policy.write !== false)
    if (targets.length === 0) return false
    return new Promise<boolean>(resolve => {
      let pending = targets.length
      for (const url of targets) {
        void this.publishTo(event, url).then(result => {
          pending -= 1
          if (result.ok) resolve(true)
          else if (pending === 0) resolve(false)
        })
      }
    })
  }

  /** Open a socket to these relays now, so the next request over them does not pay. */
  async warm(relays: readonly RelayUrl[]): Promise<void> {
    if (this.disposed) return
    await Promise.all(
      normalizeRelayUrls(relays).map(async url => {
        try {
          await this.underlying.ensureRelay(url, { connectionTimeout: this.connectTimeoutMs })
        } catch {
          // It will be tried again when something actually needs.
        }
      }),
    )
  }

  private async publishTo(event: NostrEvent, url: RelayUrl): Promise<PublishResult> {
    const record = this.ensureRecord(url)
    const startedAt = this.now()
    try {
      const relay = await this.underlying.ensureRelay(url, { connectionTimeout: this.connectTimeoutMs })
      const reason = await withTimeout(
        relay.publish(event),
        this.publishTimeoutMs,
        `publish to ${url} timed out`,
      )
      record.status.state = 'open'
      record.status.error = undefined
      record.status.latencyMs = Math.max(0, this.now() - startedAt)
      record.failures = 0
      record.nextAttemptAt = 0
      return { relay: url, ok: true, message: reason === '' ? undefined : reason }
    } catch (err) {
      const message = messageOf(err)
      if (record.status.state !== 'open') record.status.state = 'failed'
      record.status.error = message
      return { relay: url, ok: false, message }
    }
  }

  // ------------------------------------------------------------------------- Teardown.

  close(): void {
    if (this.disposed) return
    this.disposed = true

    for (const sub of [...this.subs]) sub.close()
    this.subs.clear()

    const urls = [...this.records.keys()]
    for (const record of this.records.values()) {
      record.status.state = 'closed'
      record.status.latencyMs = undefined
    }
    if (urls.length > 0) {
      try {
        this.underlying.close(urls)
      } catch {
        // Nothing useful to do while tearing down.
      }
    }
  }

  // ------------------------------------------------------------------------- Internals.

  private newRecord(url: RelayUrl, policy: RelayPolicy, configured: boolean): RelayRecord {
    return {
      url,
      policy,
      configured,
      failures: 0,
      nextAttemptAt: 0,
      countsSupported: undefined,
      countSlowUntil: undefined,
      status: { url, state: 'closed' },
      active: new Set(),
      waiting: [],
    }
  }

  private ensureRecord(url: RelayUrl): RelayRecord {
    let record = this.records.get(url)
    if (record === undefined) {
      record = this.newRecord(url, { read: true, write: true }, false)
      this.records.set(url, record)
    }
    return record
  }

  readRelays(): RelayUrl[] {
    return this.readRelayUrls()
  }

  private readRelayUrls(): RelayUrl[] {
    return this.configuredUrls('read')
  }

  private writeRelayUrls(): RelayUrl[] {
    return this.configuredUrls('write')
  }

  private configuredUrls(want: keyof RelayPolicy): RelayUrl[] {
    // No silent fallback to DEFAULT_RELAYS: the constructor already seeded them.
    return [...this.records.values()]
      .filter(record => record.configured && record.policy[want])
      .map(record => record.url)
  }
}

export function createPool(options: NostrichPoolOptions = {}): Pool {
  return new NostrichPool(options)
}
