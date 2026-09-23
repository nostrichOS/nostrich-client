'use client'

import { KINDS, getRepostedId, parseRepost, type Hex, type NostrEvent } from '@nostrich/nostr'

/** What a feed row actually shows. */
export interface DisplayedNote {
  /** The note whose words, author and counts should be rendered. */
  inner: NostrEvent
  /** Who reposted it, when this row is a repost. */
  repostedBy?: Hex
  /** Set when the envelope carried no usable copy, so the original must be fetched by id. */
  missingId?: Hex
}

export function displayedNote(event: NostrEvent): DisplayedNote {
  if (event.kind !== KINDS.repost) return { inner: event }

  const original = parseRepost(event)
  if (original !== undefined) return { inner: original, repostedBy: event.pubkey }

  // Some clients publish a kind-6 with empty content and only the `e` tag.
  const id = getRepostedId(event)
  return {
    inner: event,
    repostedBy: event.pubkey,
    ...(id === undefined ? {} : { missingId: id }),
  }
}

/** Relay hints the repost carried, so the original can be found where it actually lives. */
export function repostHints(event: NostrEvent): string[] {
  for (const tag of event.tags) {
    if (tag[0] !== 'e') continue
    const relay = tag[2]
    return relay === undefined || relay === '' ? [] : [relay]
  }
  return []
}

/** The id interaction counts should be requested. */
export function countedId(event: NostrEvent): Hex {
  const shown = displayedNote(event)
  return shown.missingId ?? shown.inner.id
}
