/** The timer that keeps `/api/trending` answering instantly. */

import { DEFAULT_RELAYS, parseProfile, verifyNip05 } from '@nostrich/nostr'
import type { Hex, NostrEvent, RelayUrl } from '@nostrich/nostr'
import process from 'node:process'

import { prisma } from '../db'
import { log, messageOf, parseRelays } from '../runtime'
import { ARTICLE_WINDOW_HOURS, buildArticles } from './articles'
import { buildWindow, mergeSources, type BuildResult } from './build'
import { recountReplies, type VerifiedCounts } from './replies'
import { resolveNotes } from './resolve'
import {
  EMPTY_RESULT,
  WINDOWS,
  WINE_SPACING_MS,
  fetchWine,
  type SourceResult,
  type Window,
} from './sources'

/** How often the whole set is rebuilt. */
const BUILD_INTERVAL_MS = envMs('TRENDING_INTERVAL_MS', 5 * 60_000)

/** A source is never allowed to hang the build behind. */
const SOURCE_TIMEOUT_MS = 15_000

/** How much thinner a new list may be than the one it replaces. */
const KEEP_RATIO = 0.6

/** Past this, a short list is published anyway. */
const STALE_SNAPSHOT_MS = 20 * 60_000

function envMs(name: string, fallback: number): number {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** Store one window's snapshot, or decide. */
async function publishSnapshot(
  hours: number,
  payload: { notes: unknown[] },
  offered: number,
  breakdown: string,
): Promise<void> {
  const label = hours === ARTICLE_WINDOW_HOURS ? 'articles' : `${hours}h`
  const detail = breakdown === '' ? '' : `, ${breakdown}`

  /* AN EMPTY BUILD NEVER REPLACES A LIST. */
  if (payload.notes.length === 0) {
    log('warn', `trending: ${label} produced nothing from ${offered} offered, keeping the previous snapshot${detail}`)
    return
  }

  /** A THINNER LIST NEVER REPLACES A FULLER ONE while the fuller one is still fresh. */
  const previous = await prisma.trendingSnapshot.findUnique({ where: { hours } })
  const fresh = previous !== null && Date.now() - previous.builtAt.getTime() < STALE_SNAPSHOT_MS
  if (fresh && payload.notes.length < previous.kept * KEEP_RATIO) {
    log('warn', `trending: ${label} built only ${payload.notes.length} against ${previous.kept} held, keeping the previous snapshot${detail}`)
    return
  }

  await prisma.trendingSnapshot.upsert({
    where: { hours },
    create: { hours, payload: payload as unknown as object, kept: payload.notes.length, offered },
    update: {
      payload: payload as unknown as object,
      kept: payload.notes.length,
      offered,
      builtAt: new Date(),
    },
  })
  log('info', `trending: ${label} kept ${payload.notes.length} of ${offered}${detail}`)
}

/** How long a NIP-05 answer is trusted before it is asked again. */
const NIP05_TTL_MS = 24 * 60 * 60_000

/** How many domains to ask. */
const NIP05_CONCURRENCY = 6

/** Per resolution. A domain that hangs must not hold up a build. */
const NIP05_TIMEOUT_MS = 4_000

const nip05Cache = new Map<Hex, { verified: boolean; at: number; claim: string }>()

/** Which of these authors have a NIP-05 that RESOLVES back to them. */
async function verifiedNip05(
  authors: readonly Hex[],
  profiles: ReadonlyMap<Hex, NostrEvent>,
): Promise<Set<Hex>> {
  const out = new Set<Hex>()
  const now = Date.now()
  const todo: { pubkey: Hex; claim: string }[] = []

  for (const pubkey of authors) {
    const meta = profiles.get(pubkey)
    const claim = meta === undefined ? '' : (parseProfile(meta).nip05 ?? '').trim()
    if (claim === '') continue
    const held = nip05Cache.get(pubkey)
    // The claim itself is part of the key: editing it is exactly when a stale answer.
    if (held !== undefined && held.claim === claim && now - held.at < NIP05_TTL_MS) {
      if (held.verified) out.add(pubkey)
      continue
    }
    todo.push({ pubkey, claim })
  }

  for (let start = 0; start < todo.length; start += NIP05_CONCURRENCY) {
    const chunk = todo.slice(start, start + NIP05_CONCURRENCY)
    const results = await Promise.all(
      chunk.map(async ({ pubkey, claim }) => {
        try {
          const status = await verifyNip05(claim, pubkey, { timeoutMs: NIP05_TIMEOUT_MS })
          return { pubkey, claim, verified: status.verified }
        } catch {
          return { pubkey, claim, verified: false }
        }
      }),
    )
    for (const { pubkey, claim, verified } of results) {
      nip05Cache.set(pubkey, { verified, at: Date.now(), claim })
      if (verified) out.add(pubkey)
    }
  }
  return out
}

/** The ids in this window's last published snapshot. */
async function previousIds(hours: number): Promise<ReadonlySet<Hex>> {
  try {
    const row = await prisma.trendingSnapshot.findUnique({ where: { hours } })
    if (row === null) return new Set()
    const payload = row.payload as { notes?: { id?: string }[] } | null
    const notes = payload?.notes ?? []
    return new Set(notes.flatMap(note => (typeof note.id === 'string' ? [note.id as Hex] : [])))
  } catch {
    return new Set()
  }
}

async function buildOne(hours: Window, relays: readonly RelayUrl[]): Promise<BuildResult> {
  /* Both indexes asked. */
  const [wine] = await Promise.allSettled([fetchWine(hours, SOURCE_TIMEOUT_MS)])
  const named: { name: string; result: SourceResult }[] = []
  if (wine?.status === 'fulfilled') named.push({ name: 'wine', result: wine.value })
  else log('warn', `trending: wine ${hours}h failed: ${messageOf(wine?.reason)}`)

  /* RESOLVE WHAT ONLY ONE INDEX NAMED, or the union is not a union. */
  const merged = mergeSources(named)
  const missing = merged.filter(entry => entry.event === undefined).map(entry => entry.id)
  if (missing.length > 0) {
    const resolved = await resolveNotes(missing, relays)
    if (resolved.events.length > 0 || resolved.profiles.length > 0) {
      named.push({
        name: 'relays',
        result: {
          notes: resolved.events.map(event => ({
            id: event.id as Hex,
            // The counts already came from the indexes.
            counts: { replies: 0, reposts: 0, quotes: 0, reactions: 0, zapSats: 0, zapCount: 0 },
            event,
          })),
          profiles: resolved.profiles,
        },
      })
    }
  }

  /* RE-COUNT THE REPLIES BEFORE ANYTHING IS SCORED. */
  // Re-merged, because resolving the missing notes above added a source.
  const candidates = mergeSources(named)
  const at = Math.floor(Date.now() / 1000)

  /* BUILD ONCE TO FIND THE SURVIVORS, RE-COUNT THOSE, THEN BUILD AGAIN. */
  /* TWO PASSES, because demoting a note promotes another one that was never checked. */
  const MAX_PASSES = 25
  /** What this window published last time, read once and used only to break ties. */
  const incumbents = await previousIds(hours)
  const shown = new Map<Hex, VerifiedCounts>()
  /** Notes this build has ALREADY ASKED ABOUT, answered. */
  const asked = new Set<string>()
  let dropped = 0
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const survivors = buildWindow(hours, named, at, shown, incumbents)
    const uncheckedIds = uncheckedIn(
      survivors.payload.notes.map(row => row.id),
      new Set(shown.keys()),
      asked,
    )
    if (uncheckedIds.length === 0) break
    const wanted = new Set(uncheckedIds)
    const unchecked = survivors.payload.notes.filter(row => wanted.has(row.id))
    for (const id of uncheckedIds) asked.add(id)
    const recount = await recountReplies(
      unchecked.map(row => ({
        id: row.id,
        replies: row.counts.replies,
        reposts: row.counts.reposts,
        reactions: row.counts.reactions,
        zapCount: row.counts.zapCount,
      })),
      relays,
    )
    dropped += recount.dropped
    for (const [id, count] of recount.kept) shown.set(id, count)
    // Asked vs answered.
    log(
      'info',
      `trending: ${hours}h pass${pass} asked=${unchecked.length} answered=${recount.kept.size} dropped=${recount.dropped}`,
    )
  }
  if (dropped > 0) {
    log('info', `trending: ${hours}h ignored ${dropped} replies that would not be shown`)
  }

  /* VERIFIED BEFORE THE LAST BUILD, and only for the authors that survived the loop. */
  const profileEvents = new Map<Hex, NostrEvent>()
  for (const { result } of named) {
    for (const event of result.profiles) {
      const held = profileEvents.get(event.pubkey as Hex)
      if (held === undefined || event.created_at > held.created_at) {
        profileEvents.set(event.pubkey as Hex, event)
      }
    }
  }
  const candidateAuthors = [
    ...new Set(
      buildWindow(hours, named, at, shown, incumbents).payload.notes.map(row => row.pubkey as Hex),
    ),
  ]
  const verifiedAuthors = await verifiedNip05(candidateAuthors, profileEvents).catch(
    () => new Set<Hex>(),
  )

  const built = buildWindow(hours, named, at, shown, incumbents, verifiedAuthors)

  /* PER NOTE, FOR THE NOTES THAT ACTUALLY REACH THE LIST. */
  const trace = built.payload.notes
    .slice(0, 10)
    .map(row => {
      const before = candidates.find(entry => entry.id === row.id)?.counts.replies ?? -1
      const counted = shown.get(row.id)
      return `${row.id.slice(0, 8)}:${before}->${counted === undefined ? 'unchecked' : counted.replies}`
    })
    .join(' ')
  log('info', `trending: ${hours}h published ${trace}`)

  return built
}

/** Which notes a verification pass should ask. */
export function uncheckedIn(
  ids: readonly string[],
  shown: ReadonlySet<string>,
  asked: ReadonlySet<string>,
): string[] {
  return ids.filter(id => !shown.has(id) && !asked.has(id))
}

export class TrendingBuilder {
  private timer: ReturnType<typeof setInterval> | undefined
  private running = false
  /** Only ever asked for notes by id and kind-0s. */
  /** The push relay set, widened with the app's own defaults for READING. */
  private readonly relays: RelayUrl[] = [
    ...new Set([...parseRelays(process.env['WORKER_RELAYS']), ...DEFAULT_RELAYS]),
  ] as RelayUrl[]

  start(): void {
    void this.build()
    this.timer = setInterval(() => void this.build(), BUILD_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
  }

  /** One pass over all three windows. */
  async build(): Promise<void> {
    // A build that overruns its own interval must not start a second copy of itself.
    if (this.running) return
    this.running = true
    try {
      for (const hours of WINDOWS) {
        try {
          const result = await buildOne(hours, this.relays)
          const breakdown = Object.entries(result.rejected)
            .sort((a, b) => b[1] - a[1])
            .map(([reason, count]) => `${reason}=${count}`)
            .join(' ')
          await publishSnapshot(hours, result.payload, result.offered, breakdown)
        } catch (error) {
          log('error', `trending: ${hours}h build failed: ${messageOf(error)}`)
        }
        // the index rate-limits.
        await sleep(WINE_SPACING_MS)
      }

      /* The ARTICLES chart, on the same timer and the same relays. */
      try {
        const articles = await buildArticles(this.relays)
        await publishSnapshot(ARTICLE_WINDOW_HOURS, articles.payload, articles.offered, '')
      } catch (error) {
        log('error', `trending: articles build failed: ${messageOf(error)}`)
      }
    } finally {
      this.running = false
    }
  }
}
