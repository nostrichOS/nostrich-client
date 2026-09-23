'use client'

import { useCallback, useState } from 'react'
import {
  buildDeletion,
  buildReaction,
  buildRepost,
  KINDS,
  Nip46TimeoutError,
  type Hex,
  type NostrEvent,
  type Signer,
} from '@nostrich/nostr'

import { announceProblem } from './outcome'
import { announcePublished } from './published'
import { getPool } from './pool'

/** Publishing a like or a repost for one note. */
export interface NotePublisher {
  /** The reader liked it in THIS session. */
  liked: boolean
  reposted: boolean
  /** Returns the id of the event it published, so a caller can record. */
  publish: (kind: 'like' | 'repost') => Promise<Hex | undefined>
  /** True once a like has been retracted in this session, so the heart does not re-fill. */
  unliked: boolean
  /** Take a like back. */
  unlike: (reactionId: Hex) => Promise<void>
}

/** WHY the heart just emptied itself, when the reader can do something. */
function sayWhy(signer: Signer | undefined, cause: unknown): void {
  if (signer?.kind !== 'nip46') return
  announceProblem(
    cause instanceof Nip46TimeoutError
      ? 'Your signer did not answer. Open it to approve, then come back.'
      : 'Your signer refused that. Open it and try again.',
  )
}

export function useNotePublisher(event: NostrEvent, signer: Signer | undefined): NotePublisher {
  const [liked, setLiked] = useState(false)
  const [reposted, setReposted] = useState(false)
  const [unliked, setUnliked] = useState(false)

  /** THE HEART FILLS ON THE PRESS, not when the relays answer. */
  const publish = useCallback(
    async (kind: 'like' | 'repost'): Promise<Hex | undefined> => {
      if (signer === undefined) return undefined
      const undo = (): void => {
        if (kind === 'like') setLiked(false)
        else setReposted(false)
      }
      if (kind === 'like') {
        setLiked(true)
        // A fresh like after an undo has to clear the undo, or `liked && !unliked` keeps.
        setUnliked(false)
      } else setReposted(true)

      try {
        const template = kind === 'like' ? buildReaction(event) : buildRepost(event)
        const signed = await signer.signEvent(template)
        /* First acceptance, not the full ledger. */
        const accepted = await getPool().publishFirstAccept(signed)
        if (!accepted) {
          undo()
          return undefined
        }
        /* Onto the same rail every other published event rides. */
        announcePublished(signed)
        return signed.id
      } catch (cause) {
        // Signing was refused or cancelled.
        undo()
        sayWhy(signer, cause)
      }
      return undefined
    },
    [event, signer],
  )

  const unlike = useCallback(
    async (reactionId: Hex): Promise<void> => {
      if (signer === undefined) return
      // Emptied on the press, for the same reason the fill.
      setUnliked(true)
      setLiked(false)
      try {
        const author = await signer.getPublicKey()
        const signed = await signer.signEvent(
          // `pubkey` is us: buildDeletion drops targets belonging to anyone else, since a relay.
          buildDeletion([{ id: reactionId, kind: KINDS.reaction, pubkey: author }], author),
        )
        await getPool().publish(signed)
        // The retraction rides the same rail the like did, so every counter that added.
        announcePublished(signed)
      } catch (cause) {
        // Signing refused: put the heart back where the reader found.
        setUnliked(false)
        setLiked(true)
        sayWhy(signer, cause)
      }
    },
    [signer],
  )

  return { liked: liked && !unliked, reposted, publish, unlike, unliked }
}
