'use client'

import { useEffect, useRef, useState } from 'react'
import {
  isCiphertext,
  DEFAULT_INDEXER_RELAYS,
  DEFAULT_RELAYS,
  EMPTY_MUTES,
  MUTE_LIST_KIND,
  buildMuteList,
  mergeMutes,
  mutedPubkeys,
  newestMuteList,
  normalizeRelayUrls,
  parseMuteList,
  parsePrivateMutes,
  privateMutesPlaintext,
  type Hex,
  type MuteEntry,
  type MuteList,
  type RelayUrl,
  type Signer,
} from '@nostrich/nostr'

import { getPool } from './pool'
import { activeScope, readScoped, writeScoped } from './scope'
import {
  addTerm,
  addToList,
  inList,
  listMembers,
  setTerms,
  termMembers,
  useUserListsVersion,
} from './user-lists'

/** Carrying the mute list between devices, over NIP-51. localStorage stays the source. */

const MUTE_RELAYS: RelayUrl[] = normalizeRelayUrls([
  'wss://purplepag.es',
  ...DEFAULT_INDEXER_RELAYS,
  ...DEFAULT_RELAYS,
])

const QUERY_TIMEOUT_MS = 6_000
/** Long enough that toggling three accounts in a row is one publish, not three. */
const PUBLISH_DEBOUNCE_MS = 2_500

/** Everything this reader has muted, in NIP-51's own vocabulary. */
function localEntries(): MuteEntry[] {
  return [
    ...listMembers('muted').map(pubkey => ({ type: 'p' as const, value: pubkey })),
    ...termMembers('mutedHashtags').map(tag => ({ type: 't' as const, value: tag })),
    ...termMembers('mutedWords').map(word => ({ type: 'word' as const, value: word })),
  ]
}

/** "This account has no mute list" and "no relay answered" are different facts. */
async function loadRemote(
  signer: Signer,
  pubkey: Hex,
): Promise<{ list: MuteList; event: ReturnType<typeof newestMuteList>; reachable: boolean }> {
  const outcome = await getPool().queryWithStatus(
    [{ kinds: [MUTE_LIST_KIND], authors: [pubkey], limit: 1 }],
    MUTE_RELAYS,
    QUERY_TIMEOUT_MS,
  )
  const events = outcome.events
  const reachable = outcome.answered > 0
  const event = newestMuteList(events)
  if (event === undefined) return { list: EMPTY_MUTES, event, reachable }

  let privateItems: MuteEntry[] = []
  if (event.content.trim() !== '') {
    try {
      privateItems = parsePrivateMutes(await signer.nip44Decrypt(pubkey, event.content))
    } catch {
      // NIP-04 for lists written by older clients.
      try {
        const legacy = await signer.nip04Decrypt?.(pubkey, event.content)
        if (legacy !== undefined) privateItems = parsePrivateMutes(legacy)
      } catch {
        // Unreadable.
      }
    }
  }

  return { list: { publicItems: parseMuteList(event), privateItems }, event, reachable }
}

/** Strip `t` and `word` entries this device no longer holds, keeping every `p`. */
export function withLocalTerms(list: MuteList): MuteList {
  const hashtags = new Set(termMembers('mutedHashtags'))
  const words = new Set(termMembers('mutedWords'))
  const keep = (item: MuteEntry): boolean => {
    if (item.type === 't') return hashtags.has(item.value)
    if (item.type === 'word') return words.has(item.value)
    return true
  }
  return {
    publicItems: list.publicItems.filter(keep),
    privateItems: list.privateItems.filter(keep),
  }
}

/** Drop the accounts this reader deliberately un-muted. */
export function withoutUnmuted(list: MuteList): MuteList {
  const graves = new Set(listMembers('unmuted'))
  if (graves.size === 0) return list
  const keep = (item: MuteEntry): boolean => item.type !== 'p' || !graves.has(item.value)
  return {
    publicItems: list.publicItems.filter(keep),
    privateItems: list.privateItems.filter(keep),
  }
}

/** AN ACCOUNT IS NEVER IN ITS OWN PUBLISHED MUTE LIST. */
export function withoutSelf(list: MuteList, self: Hex): MuteList {
  const keep = (item: MuteEntry): boolean => item.type !== 'p' || item.value !== self
  if (list.publicItems.every(keep) && list.privateItems.every(keep)) return list
  return {
    publicItems: list.publicItems.filter(keep),
    privateItems: list.privateItems.filter(keep),
  }
}

/** Hashtags and words the reader muted somewhere ELSE, brought into this device's lists. */
export function adoptTerms(list: MuteList): void {
  for (const item of [...list.publicItems, ...list.privateItems]) {
    if (item.type === 't') addTerm('mutedHashtags', item.value)
    if (item.type === 'word') addTerm('mutedWords', item.value)
  }
}

/** Where this device last got to, so it can tell somebody else's edit from its own. */
const SYNCED_AT_KEY = 'nostrich:mutes-synced-at'

function syncedAt(): number {
  const raw = Number(readScoped(SYNCED_AT_KEY))
  return Number.isFinite(raw) ? raw : 0
}

/** RECONCILE TERMS AGAINST A LIST THAT IS NEWER THAN ANYTHING THIS DEVICE PUBLISHED. */
export function reconcileTerms(list: MuteList, remoteCreatedAt: number): boolean {
  if (remoteCreatedAt <= syncedAt()) return false
  const items = [...list.publicItems, ...list.privateItems]
  setTerms('mutedHashtags', items.filter(item => item.type === 't').map(item => item.value))
  setTerms('mutedWords', items.filter(item => item.type === 'word').map(item => item.value))
  writeScoped(SYNCED_AT_KEY, String(remoteCreatedAt))
  return true
}

/** Keeps the local mute list and the published one in step. */
export function useMuteSync(signer: Signer | undefined, pubkey: Hex | undefined): void {
  const version = useUserListsVersion()
  /** Bumped when the PUBLISHED list is found to contain the reader themselves, to force. */
  const [repair, setRepair] = useState(0)

  /** The event being replaced, so unknown tags on it survive the next publish. */
  const previous = useRef<ReturnType<typeof newestMuteList>>(undefined)
  const remote = useRef<MuteList>(EMPTY_MUTES)
  const hydrated = useRef(false)
  /** Suppresses the publish that hydration itself would otherwise trigger. */
  const settling = useRef(true)
  /** Whether any relay answered the read this session. */
  const readable = useRef(false)

  useEffect(() => {
    hydrated.current = false
    settling.current = true
    readable.current = false
    previous.current = undefined
    remote.current = EMPTY_MUTES
    if (signer === undefined || pubkey === undefined) return

    let cancelled = false
    void (async () => {
      try {
        const { list, event, reachable } = await loadRemote(signer, pubkey)
        /** STILL THE ACCOUNT IN FRONT? `cancelled` is not enough to answer. */
        if (cancelled || activeScope() !== pubkey) return
        remote.current = list
        previous.current = event
        /* Only a list somebody actually answered with may be written on top. */
        readable.current = reachable

        /* Remote-only entries take effect here. */
        /* The reader themselves is never adopted into the local list. */
        let namesSelf = false
        for (const muted of mutedPubkeys(list)) {
          if (muted === pubkey) {
            namesSelf = true
            continue
          }
          if (inList('unmuted', muted)) continue
          addToList('muted', muted)
        }
        // One corrective publish, and only if there is something to correct.
        if (namesSelf) setRepair(count => count + 1)
        // Terms follow the newest published list when there is one.
        if (!reconcileTerms(list, event?.created_at ?? 0)) adoptTerms(list)
      } catch {
        // Offline, or every relay refused.
      } finally {
        if (!cancelled) {
          hydrated.current = true
          settling.current = false
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [signer, pubkey])

  useEffect(() => {
    if (signer === undefined || pubkey === undefined) return
    if (!hydrated.current || settling.current) return
    // Nothing was read, so there is nothing safe to replace.
    if (!readable.current) return

    const timer = setTimeout(() => {
      void (async () => {
        try {
          /* The same question the hydration asks, for the same reason. */
          if (activeScope() !== pubkey) return

          /* ADDITIVE FOR ACCOUNTS, AUTHORITATIVE FOR TERMS. */
          const merged = withoutSelf(
            withoutUnmuted(withLocalTerms(mergeMutes(remote.current, localEntries()))),
            pubkey,
          )

          /** No private half means nothing to encrypt. */
          const content =
            merged.privateItems.length === 0
              ? ''
              : await signer.nip44Encrypt(pubkey, privateMutesPlaintext(merged.privateItems))

          /** Never publish a mute list whose private half encrypted to nothing. */
          if (merged.privateItems.length > 0 && !isCiphertext(content)) return

          const template = buildMuteList({
            items: merged.publicItems,
            encryptedContent: content,
            previous: previous.current,
          })
          const signed = await signer.signEvent(template)
          const results = await getPool().publish(signed)
          if (!results.some(result => result.ok)) return

          // The signed event becomes the new base: the next publish has to carry its tags.
          previous.current = signed
          remote.current = merged
          // Our own write is not news from elsewhere.
          writeScoped(SYNCED_AT_KEY, String(signed.created_at))
        } catch {
          // Refused at the signer, offline, or unable to encrypt.
        }
      })()
    }, PUBLISH_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [version, repair, signer, pubkey])
}
