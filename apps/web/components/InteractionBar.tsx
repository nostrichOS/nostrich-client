'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { NoteCounts } from '@nostrich/app'
import { bookmarkForEvent, type NostrEvent } from '@nostrich/nostr'

import { useBookmarks } from '../lib/bookmarks'
import { useForgetLike, useLikeIndex, useRememberLike } from '../lib/likes'
import { noteHref } from '../lib/links'
import { useMyReposts, useMyZaps, useRememberRepost, useRememberZap } from '../lib/my-actions'
import { useNotePublisher } from '../lib/note-actions'
import { useQuickZap } from '../lib/quick-zap'
import { sessionPubkey, useSession } from './SessionProvider'
import { ComposeModal } from './ComposeModal'
import { RepostMenu } from './RepostMenu'
import { ActionRow } from './ActionRow'
import { ZapDialog } from './ZapDialog'

/** Reply, repost, zap, like, bookmark. */
export function InteractionBar({
  event,
  counts,
}: {
  event: NostrEvent
  counts?: NoteCounts
}): React.ReactNode {
  const { session } = useSession()
  const router = useRouter()
  const signer = session.status === 'signed' ? session.signer : undefined
  const signedIn = sessionPubkey(session) !== undefined

  const [repostAt, setRepostAt] = useState<{ x: number; y: number } | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [zapping, setZapping] = useState(false)
  /** Why the dialog opened, when a one-tap zap failed on the way. */
  const [zapError, setZapError] = useState<string | undefined>(undefined)
  // Set when a one-tap zap PAID but did not become a zap.
  const [zapNotice, setZapNotice] = useState<string | undefined>(undefined)
  const pressRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  const { liked, reposted, unliked, publish, unlike } = useNotePublisher(event, signer)
  const likeIndex = useLikeIndex()
  const priorLike = likeIndex.get(event.id)
  const forgetLike = useForgetLike()
  const rememberLike = useRememberLike()
  const alreadyLiked = !unliked && (liked || priorLike !== undefined)

  const myReposts = useMyReposts()
  const myZaps = useMyZaps()
  const rememberRepost = useRememberRepost()
  const rememberZap = useRememberZap()
  const alreadyReposted = reposted || myReposts.has(event.id)
  const alreadyZapped = myZaps.has(event.id)

  const bookmarks = useBookmarks()
  const bookmark = useMemo(() => bookmarkForEvent(event), [event])

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

  const requireSigner = useCallback((): boolean => {
    if (signedIn) return true
    router.push('/login')
    return false
  }, [signedIn, router])

  return (
    <div
      // The repost menu opens where the reader pressed, and the shared action row hands.
      onPointerDownCapture={pointerEvent => {
        pressRef.current = { x: pointerEvent.clientX, y: pointerEvent.clientY }
      }}
    >
      <ActionRow
        counts={counts}
        liked={alreadyLiked}
        reposted={alreadyReposted}
        zapped={alreadyZapped}
        bookmarked={bookmarks.has(bookmark)}
        onReply={() => {
          if (requireSigner()) router.push(noteHref(event))
        }}
        onLike={() => {
          if (!requireSigner()) return
          // A filled heart means "you liked this", so pressing it has to be able to undo.
          if (priorLike !== undefined && !unliked) {
            void unlike(priorLike)
            forgetLike(event.id)
          } else if (!alreadyLiked) {
            void publish('like').then(reactionId => {
              if (reactionId !== undefined) rememberLike(event.id, reactionId)
            })
          }
        }}
        onRepost={() => {
          if (requireSigner()) setRepostAt(pressRef.current)
        }}
        onZapTap={async () => {
          if (!requireSigner()) return undefined
          return quickZap()
        }}
        onZapMenu={() => {
          if (requireSigner()) setZapping(true)
        }}
        onBookmark={() => {
          if (requireSigner()) bookmarks.toggle(bookmark)
        }}
      />

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
          onZapped={() => rememberZap(event.id)}
          onClose={() => setZapping(false)}
        />
      ) : null}
    </div>
  )
}
