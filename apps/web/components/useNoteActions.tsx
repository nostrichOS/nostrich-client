'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { bookmarkForEvent, type NostrEvent } from '@nostrich/nostr'

import { useBookmarks } from '../lib/bookmarks'
import { useForgetLike, useLikeIndex, useRememberLike } from '../lib/likes'
import { useMyReposts, useMyZaps, useRememberRepost, useRememberZap } from '../lib/my-actions'
import { useNotePublisher } from '../lib/note-actions'
import { useQuickZap } from '../lib/quick-zap'
import { ComposeModal } from './ComposeModal'
import { RepostMenu } from './RepostMenu'
import { sessionPubkey, useSession } from './SessionProvider'
import { ZapDialog } from './ZapDialog'

/** Everything a note's action row does, in one place. */
export interface NoteActions {
  signedIn: boolean
  /** True when there is a key to act. */
  requireSigner: () => boolean
  liked: boolean
  reposted: boolean
  zapped: boolean
  bookmarked: boolean
  onLike: () => void
  /** Opens the repost menu at a point. */
  onRepost: (at: { x: number; y: number }) => void
  onBookmark: () => void
  /** Resolves to the amount sent, or undefined when the dialog took over instead. */
  onZapTap: () => Promise<number | undefined>
  onZapMenu: () => void
  /** RepostMenu, the quote composer and the zap dialog. */
  overlays: React.ReactNode
}

export function useNoteActions(event: NostrEvent): NoteActions {
  const router = useRouter()
  const { session } = useSession()
  const signer = session.status === 'signed' ? session.signer : undefined
  const signedIn = sessionPubkey(session) !== undefined && signer !== undefined

  const [repostAt, setRepostAt] = useState<{ x: number; y: number } | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [zapping, setZapping] = useState(false)
  /** Why the dialog opened, when a one-tap zap failed on the way. */
  const [zapError, setZapError] = useState<string | undefined>(undefined)
  // Set when a one-tap zap PAID but did not become a zap.
  const [zapNotice, setZapNotice] = useState<string | undefined>(undefined)

  const { liked, reposted, unliked, publish, unlike } = useNotePublisher(event, signer)
  // Liked in THIS session, or liked at any point in the past.
  const likeIndex = useLikeIndex()
  const priorLike = likeIndex.get(event.id)
  const forgetLike = useForgetLike()
  const rememberLike = useRememberLike()
  const alreadyLiked = !unliked && (liked || priorLike !== undefined)

  /** The same "did I already" treatment the heart has had, for the other two published. */
  const myReposts = useMyReposts()
  const myZaps = useMyZaps()
  const rememberRepost = useRememberRepost()
  const rememberZap = useRememberZap()
  const alreadyReposted = reposted || myReposts.has(event.id)
  const alreadyZapped = myZaps.has(event.id)

  /** Every action needs a key. */
  const requireSigner = useCallback((): boolean => {
    if (signedIn) return true
    router.push('/login')
    return false
  }, [signedIn, router])

  /** A tap on the bolt sends the reader's default amount. */
  const quickZap = useQuickZap({
    viewer: sessionPubkey(session),
    recipient: event.pubkey,
    event,
    signer,
    onZapped: () => rememberZap(event.id),
    openDialog: outcome => {
      setZapError(outcome?.error)
      setZapNotice(outcome?.notice)
      setZapping(true)
    },
  })

  // An article is saved by address and a note by id.
  const bookmarks = useBookmarks()
  const bookmark = useMemo(() => bookmarkForEvent(event), [event])

  const onLike = useCallback(() => {
    if (!requireSigner()) return
    // A filled heart means "you liked this", so pressing it has to be able to undo.
    if (priorLike !== undefined && !unliked) {
      void unlike(priorLike)
      // The History → Likes tab is built from this list, so the row has to go now rather.
      forgetLike(event.id)
    } else if (!alreadyLiked) {
      void publish('like').then(reactionId => {
        if (reactionId !== undefined) rememberLike(event.id, reactionId)
      })
    }
  }, [requireSigner, priorLike, unliked, unlike, forgetLike, alreadyLiked, publish, rememberLike, event.id])

  const onRepost = useCallback(
    (at: { x: number; y: number }) => {
      if (requireSigner()) setRepostAt(at)
    },
    [requireSigner],
  )

  const onBookmark = useCallback(() => {
    if (requireSigner()) bookmarks.toggle(bookmark)
  }, [requireSigner, bookmarks, bookmark])

  const onZapTap = useCallback(async () => {
    if (!requireSigner()) return undefined
    return quickZap()
  }, [requireSigner, quickZap])

  const onZapMenu = useCallback(() => {
    if (requireSigner()) setZapping(true)
  }, [requireSigner])

  const overlays = (
    <>
      {repostAt === null ? null : (
        <RepostMenu
          at={repostAt}
          reposted={alreadyReposted}
          onRepost={() => {
            void publish('repost').then(() => {
              rememberRepost(event.id)
            })
          }}
          onQuote={() => setQuoting(true)}
          onClose={() => setRepostAt(null)}
        />
      )}

      {/* The note is handed over as a QUOTE, not as text. */}
      {quoting ? (
        <ComposeModal
          quoting={{ id: event.id, pubkey: event.pubkey }}
          onClose={() => setQuoting(false)}
        />
      ) : null}

      {zapping && signer !== undefined ? (
        <ZapDialog
          viewer={sessionPubkey(session)}
          recipient={event.pubkey}
          event={event}
          signer={signer}
          {...(zapError === undefined ? {} : { initialError: zapError })}
          {...(zapNotice === undefined ? {} : { initialNotice: zapNotice })}
          // Recorded on payment rather than on close: the receipt is published by a lightning.
          onZapped={() => rememberZap(event.id)}
          onClose={() => setZapping(false)}
        />
      ) : null}
    </>
  )

  return {
    signedIn,
    requireSigner,
    liked: alreadyLiked,
    reposted: alreadyReposted,
    zapped: alreadyZapped,
    bookmarked: bookmarks.has(bookmark),
    onLike,
    onRepost,
    onBookmark,
    onZapTap,
    onZapMenu,
    overlays,
  }
}
