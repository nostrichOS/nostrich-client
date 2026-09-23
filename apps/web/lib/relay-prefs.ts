'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_RELAYS,
  DEFAULT_RELAY_ENTRIES,
  buildRelayListEvent,
  normalizeRelayUrl,
  tryNormalizeRelayUrl,
  type RelayEntry,
} from '@nostrich/nostr'

import {
  parseRelayCookie,
  sameRelayList,
  serializeRelayCookie,
  type RelayPolicyChoice,
  type StoredRelays,
  type StoredSource,
} from './relay-cookie'
import { fetchRelayList, useImportedRelayList, type ImportedRelays } from './relay-list-import'
import { mergeRelayList } from './relay-publish'
import { sessionPubkey, sessionSigner, useSession } from '../components/SessionProvider'
import { getPool } from './pool'

/** The reader's relay list. */

const COOKIE = 'nostrich_relays'
/** A year. The list is a preference, not a session. */
const MAX_AGE = 31_536_000

/** Keeps a runaway paste or a malicious link from opening hundreds of sockets. */
const MAX_RELAYS = 20

/** Where the list on screen came. */
export type RelaySource = 'defaults' | 'imported' | 'edited'

function readCookie(): StoredRelays | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.split('; ').find(row => row.startsWith(`${COOKIE}=`))
  if (match === undefined) return null
  return parseRelayCookie(decodeURIComponent(match.slice(COOKIE.length + 1)))
}

/** TELL THE POOL. Without this, none of this file does anything. */
export function applyRelaysToPool(
  urls: readonly string[],
  policies: Readonly<Record<string, RelayPolicyChoice>> = {},
): void {
  const entries = urls.flatMap(raw => {
    const url = tryNormalizeRelayUrl(raw)
    if (url === undefined) return []
    const choice = policies[raw] ?? policies[url] ?? 'both'
    return [{ url, policy: { read: choice !== 'write', write: choice !== 'read' } }]
  })
  // An empty set would leave the reader connected to nothing at all, which no edit.
  if (entries.length === 0) return
  getPool().setRelays(entries)
}

function writeCookie(
  urls: string[],
  src: StoredSource,
  policies?: Readonly<Record<string, RelayPolicyChoice>>,
): void {
  // Applied on every write, so a change takes effect on the press rather.
  applyRelaysToPool(urls, policies)
  if (typeof document === 'undefined') return
  const value = encodeURIComponent(serializeRelayCookie(urls, src, policies))
  // `SameSite=Lax` because nothing cross-site should ever be able to rewrite.
  document.cookie = `${COOKIE}=${value}; path=/; max-age=${MAX_AGE}; SameSite=Lax`
}

export interface RelayPrefs {
  relays: string[]
  /** True when the reader has customised the list, so the UI can offer a reset. */
  customised: boolean
  /** Where the list on screen came. */
  source: RelaySource
  /** True when this list came from the reader's own kind-10002 rather. */
  imported: boolean
  add: (url: string) => string | null
  remove: (url: string) => void
  /** What a relay. */
  setPolicy: (url: string, choice: RelayPolicyChoice) => void
  /** The choices made here, by url. */
  policies: Readonly<Record<string, RelayPolicyChoice>>
  /** Back to the relays NOSTRICH ships. */
  reset: () => void
  /** Back to the relays the READER published, as a kind-10002. The other half. */
  restorePublished: () => Promise<RestoreOutcome>
  /** True while `restorePublished` is in flight, so the button can say. */
  restoring: boolean
  /** Whether this reader can be asked for a published list at all. */
  canRestorePublished: boolean
  /** Announce this list to the network as a kind-10002. The half of NIP-65 this app. */
  publish: () => Promise<PublishOutcome>
  /** True while a publish is in flight. */
  publishing: boolean
  /** True when the list here differs from what the network has been told. */
  needsPublish: boolean
}

/** `no-signer` is not a failure either. */
export type PublishOutcome = 'ok' | 'no-signer' | 'declined' | 'error'

/** `none` is not an error and is reported separately. */
export type RestoreOutcome = 'ok' | 'none' | 'error'

/** The shipped defaults as a policy map, in the shape this screen uses. */
const defaultPolicies: Readonly<Record<string, RelayPolicyChoice>> = Object.fromEntries(
  DEFAULT_RELAY_ENTRIES.filter(entry => !(entry.policy.read && entry.policy.write)).map(entry => [
    entry.url as string,
    entry.policy.read ? 'read' : 'write',
  ]),
)

/** A published list's markers, in the shape this screen uses. */
/** Whether two policy maps agree about every relay in the list. */
function samePolicies(
  a: Readonly<Record<string, RelayPolicyChoice>>,
  b: Readonly<Record<string, RelayPolicyChoice>>,
  urls: readonly string[],
): boolean {
  return urls.every(url => (a[url] ?? 'both') === (b[url] ?? 'both'))
}

function policiesFrom(entries: readonly RelayEntry[]): Record<string, RelayPolicyChoice> {
  const out: Record<string, RelayPolicyChoice> = {}
  for (const entry of entries) {
    // Recorded for every entry, `both` included: the map is "what was decided.
    out[entry.url as string] =
      entry.policy.read && entry.policy.write ? 'both' : entry.policy.read ? 'read' : 'write'
  }
  return out
}

export function useRelayPrefs(): RelayPrefs {
  const [relays, setRelays] = useState<string[]>([...DEFAULT_RELAYS])
  const [source, setSource] = useState<RelaySource>('defaults')
  /* Seeded from the shipped defaults, which are not uniformly read+write. */
  const [policies, setPolicies] = useState<Record<string, RelayPolicyChoice>>(defaultPolicies)
  /** THE READER HAS TOUCHED THIS SCREEN. */
  const touched = useRef(false)
  const [restoring, setRestoring] = useState(false)
  const [publishing, setPublishing] = useState(false)
  /** The list the network has been told about, as far as this session knows. */
  const [announced, setAnnounced] = useState<string[] | null>(null)
  /** The POLICIES the network was last known to have, beside the urls. */
  const [announcedPolicies, setAnnouncedPolicies] = useState<Record<string, RelayPolicyChoice>>({})
  /** False until the cookie has been read. */
  const [hydrated, setHydrated] = useState(false)
  const { session } = useSession()
  const pubkey = sessionPubkey(session)

  /* `hydrated` is what makes the import safe. */
  useEffect(() => {
    const stored = readCookie()
    if (stored !== null) {
      setRelays(stored.urls)
      setSource(stored.src)
      /* THE COOKIE WINS ENTIRELY, including when it names no policies. */
      setPolicies(stored.policies === undefined ? {} : { ...stored.policies })
      // An imported list is by definition what they published, so it needs no publishing.
      if (stored.src === 'imported') {
        setAnnounced(stored.urls)
        setAnnouncedPolicies(stored.policies === undefined ? {} : { ...stored.policies })
      }
    }
    setHydrated(true)
  }, [])

  const commit = useCallback(
    (next: string[], nextPolicies: Record<string, RelayPolicyChoice>) => {
      touched.current = true
      setRelays(next)
      setPolicies(nextPolicies)
      setSource('edited')
      writeCookie(next, 'edited', nextPolicies)
    },
    [],
  )

  /** A relay's job, chosen on its own row. */
  const setPolicy = useCallback(
    (url: string, choice: RelayPolicyChoice) => {
      touched.current = true
      setPolicies(current => {
        // Recorded whatever it is, `both` included: an omitted entry means "no decision".
        const next = { ...current, [url]: choice }
        setSource('edited')
        writeCookie(relays, 'edited', next)
        return next
      })
    },
    [relays],
  )

  /** Their published list, adopted when they have not chosen one here. */
  const applyImported = useCallback((found: ImportedRelays) => {
    /* Checked AGAIN at the moment of applying, not only before fetching. */
    if (touched.current) return
    if (readCookie()?.src === 'edited') return
    /* THE MARKERS COME. */
    const next = policiesFrom(found.entries)
    setRelays(found.urls)
    setSource('imported')
    setAnnounced(found.urls)
    setAnnouncedPolicies(next)
    setPolicies(next)
    writeCookie(found.urls, 'imported', next)
  }, [])

  /* THEIR OWN LIST IS THE DEFAULT, not a one-time seed. */
  useImportedRelayList(hydrated ? pubkey : undefined, source === 'edited', applyImported)

  const add = useCallback(
    (raw: string): string | null => {
      let url: string
      try {
        url = normalizeRelayUrl(raw)
      } catch {
        return 'That is not a relay URL. They look like wss://relay.example.com'
      }
      if (relays.includes(url)) return 'Already in your list.'
      if (relays.length >= MAX_RELAYS) return `That is the limit of ${MAX_RELAYS} relays.`
      commit([...relays, url], policies)
      return null
    },
    [relays, policies, commit],
  )

  const remove = useCallback(
    (url: string) => {
      // Removing the last relay would silently empty the feed with no way back except.
      if (relays.length <= 1) return
      // Its policy goes with it, or a relay re-added later would silently inherit a choice.
      const { [url]: gone, ...rest } = policies
      void gone
      commit(
        relays.filter(candidate => candidate !== url),
        rest,
      )
    },
    [relays, policies, commit],
  )

  /** Adopt their published list on demand. */
  const restorePublished = useCallback(async (): Promise<RestoreOutcome> => {
    if (pubkey === undefined) return 'none'
    setRestoring(true)
    try {
      const found = await fetchRelayList(pubkey)
      if (found === null) return 'none'
      setRelays(found.urls)
      setSource('imported')
      setAnnounced(found.urls)
      // Their published markers ARE the policy now.
      setPolicies({})
      writeCookie(found.urls, 'imported')
      return 'ok'
    } catch {
      return 'error'
    } finally {
      setRestoring(false)
    }
  }, [pubkey])

  const reset = useCallback(() => {
    /* CHOOSING THE DEFAULTS IS A CHOICE, and has to be stored as one. */
    touched.current = true
    setRelays([...DEFAULT_RELAYS])
    setSource('edited')
    setPolicies({ ...defaultPolicies })
    writeCookie([...DEFAULT_RELAYS], 'edited', defaultPolicies)
  }, [])

  /** Sign a kind-10002 naming these relays and send it out. */
  const publish = useCallback(async (): Promise<PublishOutcome> => {
    const signer = sessionSigner(session)
    if (signer === undefined) return 'no-signer'
    setPublishing(true)
    try {
      /* THEIR CURRENT LIST IS FETCHED FIRST, and this is not an optimisation. */
      let published: RelayEntry[] = []
      if (pubkey !== undefined) {
        const current = await fetchRelayList(pubkey)
        /* Null means "they have never published one" OR "nobody answered", and those must. */
        if (current === null && announced !== null) return 'error'
        published = current?.entries ?? []
      }
      const template = buildRelayListEvent(mergeRelayList(relays, published, policies) as never)
      /* The two stages are reported apart, because they are the two things that actually go. */
      let signed
      try {
        signed = await signer.signEvent(template as never)
      } catch {
        return 'declined'
      }
      const results = await getPool().publish(signed as never)
      if (!results.some(result => result.ok)) return 'error'
      /* RECORDED IN THE COOKIE, not only in React state. */
      setSource('imported')
      setAnnounced([...relays])
      setAnnouncedPolicies({ ...policies })
      /* The choices are KEPT, not dropped. */
      writeCookie(relays, 'imported', policies)
      return 'ok'
    } catch {
      return 'error'
    } finally {
      setPublishing(false)
    }
  /* `policies` IS a dependency, and leaving it out was the whole bug. */
  }, [relays, session, pubkey, announced, policies])

  return {
    relays,
    customised: source !== 'defaults',
    source,
    imported: source === 'imported',
    add,
    remove,
    setPolicy,
    policies,
    reset,
    restorePublished,
    restoring,
    canRestorePublished: pubkey !== undefined,
    publish,
    publishing,
    needsPublish:
      sessionSigner(session) !== undefined &&
      source === 'edited' &&
      (announced === null ||
        !sameRelayList(relays, announced) ||
        // A marker-only change is still a change.
        !samePolicies(policies, announcedPolicies, relays)),
  }
}
