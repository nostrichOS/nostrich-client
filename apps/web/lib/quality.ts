'use client'

import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Hex, NostrEvent, Profile } from '@nostrich/nostr'

import { readCachedNip05, readCachedProfile } from './profile-cache'
import { advertisingReply } from './trust'
import { hasAdultName } from './spam'
import { nip05Query, profileQuery } from './profiles'

/** The one spam rule that pays for itself. */
const GRACE_MS = 4_000

type Status = 'loading' | 'pass' | 'fail'

export interface ProfileGateOptions {
  /** False turns the gate into a pass-through. */
  enabled: boolean
  /** Additionally require a NIP-05 that resolves back to this pubkey. */
  requireNip05: boolean
  /** One pubkey the gate never judges. */
  alwaysAllow?: Hex | undefined
}

/** Whether the AUTHOR clears the gate, as a pure function, because the order. */
export function authorAccepted(
  pubkey: Hex,
  verdict: Status | undefined,
  alwaysAllow: Hex | undefined,
): boolean {
  // First, and never after the verdict: the point of the exemption is to hold.
  if (alwaysAllow !== undefined && pubkey === alwaysAllow) return true
  return verdict === 'pass'
}

export interface ProfileGate {
  accepts: (event: NostrEvent) => boolean
  /** True while authors are still inside the grace window. */
  settling: boolean
}

/** A profile is "usable" when it gives the reader a name to recognise or report. */
export function hasUsableName(profile: Profile | null): boolean {
  if (profile === null) return false
  return [profile.displayName, profile.name].some(value => value !== undefined && value.trim() !== '')
}

async function judge(client: QueryClient, pubkey: Hex, requireNip05: boolean): Promise<Status> {
  // fetchQuery, not a bare loadProfile call: it shares the cache with every avatar.
  const profile = await client.fetchQuery(profileQuery(pubkey))
  if (!hasUsableName(profile)) return 'fail'
  // An account whose own handle announces adult content is not shown on a surface.
  if (hasAdultName(profile)) return 'fail'
  if (!requireNip05) return 'pass'

  const claim = profile?.nip05
  if (claim === undefined) return 'fail'
  return (await client.fetchQuery(nip05Query(pubkey, claim))) ? 'pass' : 'fail'
}

/** Verdicts for the authors of `events`, resolved through the shared batched loader. */
/** Verdicts already reached this session, keyed by rule as well as pubkey. */
const FAIL_TTL_MS = 60_000

const settled = new Map<string, { status: Status; at: number }>()

function remembered(pubkey: Hex, requireNip05: boolean): Status | undefined {
  const held = settled.get(verdictKey(pubkey, requireNip05))
  if (held === undefined) return undefined
  if (held.status === 'fail' && Date.now() - held.at > FAIL_TTL_MS) return undefined
  return held.status
}

const verdictKey = (pubkey: Hex, requireNip05: boolean): string =>
  `${requireNip05 ? 'nip05' : 'profile'}:${pubkey}`

/** Everything already known about these authors, for a synchronous first paint. */
function seedVerdicts(events: readonly NostrEvent[], requireNip05: boolean): Map<Hex, Status> {
  const seed = new Map<Hex, Status>()
  for (const event of events) {
    const known = remembered(event.pubkey, requireNip05)
    if (known !== undefined) {
      seed.set(event.pubkey, known)
      continue
    }

    const cached = readCachedProfile(event.pubkey)
    if (cached === undefined || !hasUsableName(cached.profile)) continue
    // Never seeded as a pass, so a name yesterday's cache already knows about cannot.
    if (hasAdultName(cached.profile)) continue
    if (!requireNip05) {
      seed.set(event.pubkey, 'pass')
      continue
    }
    // The stricter rule needs the well-known check too, and only a remembered PASS.
    const claim = cached.profile.nip05
    if (claim === undefined) continue
    if (readCachedNip05(event.pubkey, claim)?.ok === true) seed.set(event.pubkey, 'pass')
  }
  return seed
}

export function useProfileGate(events: readonly NostrEvent[], options: ProfileGateOptions): ProfileGate {
  const client = useQueryClient()
  const { enabled, requireNip05, alwaysAllow } = options

  const [verdicts, setVerdicts] = useState<ReadonlyMap<Hex, Status>>(() =>
    seedVerdicts(events, requireNip05),
  )
  const [graceEndsAt, setGraceEndsAt] = useState(0)
  const [graceOver, setGraceOver] = useState(true)
  /** Request bookkeeping only. Never read during render, so it needs no state. */
  const askedRef = useRef<Set<Hex>>(new Set())
  /** Bumped when the rule changes, so verdicts still in flight under the old rule. */
  const ruleRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Tightening the rule invalidates every verdict already reached under the looser one.
  useEffect(() => {
    ruleRef.current += 1
    askedRef.current = new Set()
    setVerdicts(new Map())
  }, [requireNip05])

  useEffect(() => {
    if (!enabled) return

    const fresh: Hex[] = []
    const known: [Hex, Status][] = []
    for (const event of events) {
      if (askedRef.current.has(event.pubkey)) continue
      askedRef.current.add(event.pubkey)
      const held = remembered(event.pubkey, requireNip05)
      if (held !== undefined) known.push([event.pubkey, held])
      else fresh.push(event.pubkey)
    }

    // Authors judged earlier this session go straight.
    if (known.length > 0) {
      setVerdicts(current => {
        const next = new Map(current)
        for (const [pubkey, status] of known) next.set(pubkey, status)
        return next
      })
    }
    if (fresh.length === 0) return

    setVerdicts(current => {
      const next = new Map(current)
      for (const pubkey of fresh) next.set(pubkey, 'loading')
      return next
    })
    // Newly arrived authors get their own grace window.
    setGraceEndsAt(Date.now() + GRACE_MS)
    setGraceOver(false)

    // Not cancelled on cleanup: this effect re-runs on every batch of arriving notes.
    const rule = ruleRef.current
    for (const pubkey of fresh) {
      void judge(client, pubkey, requireNip05)
        .catch(() => {
          /** "We could not ask" is not a fail, and it must not be a permanent 'loading' either. */
          askedRef.current.delete(pubkey)
          return 'loading' as Status
        })
        .then(status => {
          // Remembered before the mount check: the answer is just as valid if the reader.
          if (status !== 'loading') {
            settled.set(verdictKey(pubkey, requireNip05), { status, at: Date.now() })
          }
          if (!mountedRef.current || ruleRef.current !== rule) return
          setVerdicts(current => {
            if (current.get(pubkey) === status) return current
            const next = new Map(current)
            next.set(pubkey, status)
            return next
          })
        })
    }
  }, [events, enabled, requireNip05, client])

  useEffect(() => {
    if (graceEndsAt === 0) return
    const timer = setTimeout(() => setGraceOver(true), Math.max(0, graceEndsAt - Date.now()))
    return () => clearTimeout(timer)
  }, [graceEndsAt])

  const accepts = useCallback(
    (event: NostrEvent): boolean => {
      if (!enabled) return true
      /* THE READER'S OWN NOTE IS NEVER JUDGED. */
      if (!authorAccepted(event.pubkey, verdicts.get(event.pubkey), alwaysAllow)) return false
      /* AND one rule about the NOTE rather than the author. */
      return !advertisingReply(event)
    },
    [enabled, verdicts, alwaysAllow],
  )

  const waiting = useMemo(() => {
    if (!enabled) return false
    for (const status of verdicts.values()) if (status === 'loading') return true
    return false
  }, [enabled, verdicts])

  return useMemo(() => ({ accepts, settling: waiting && !graceOver }), [accepts, waiting, graceOver])
}

/** One note per author. */
export function onePerAuthor<T extends { pubkey: Hex }>(list: readonly T[]): T[] {
  return capPerAuthor(list, 1)
}

/** At most `max` per author, same rules as `onePerAuthor`. */
export function capPerAuthor<T extends { pubkey: Hex }>(list: readonly T[], max: number): T[] {
  if (max < 1) return []
  const held = new Map<Hex, number>()
  const out: T[] = []
  for (const item of list) {
    const count = held.get(item.pubkey) ?? 0
    if (count >= max) continue
    held.set(item.pubkey, count + 1)
    out.push(item)
  }
  return out
}
