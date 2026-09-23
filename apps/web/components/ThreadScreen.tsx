'use client'

import { use, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { NoteCounts } from '@nostrich/app'
import { KINDS, eventAddress, isAddressable, type Hex, type NostrEvent, type ThreadNode } from '@nostrich/nostr'

import { resolveEntity } from '../lib/entity'
import { engagementScore } from '../lib/engagement'
import { liftZapCounts, useInteractions, type ZapDetail } from '../lib/interactions'
import { useNoteZaps } from '../lib/note-zaps'
import { mergeWalletZaps, useWalletZaps } from '../lib/wallet-zaps'
import { noteHref } from '../lib/links'
import { displayedNote } from '../lib/reposts'
import { useThread } from '../lib/thread'
import { useProfileGate } from '../lib/quality'
import { isMutedContent } from '../lib/muted-content'
import { advertisingReply } from '../lib/trust'
import { rankReplies } from '../lib/thread-ranking'

import { ArticleScreen } from './ArticleScreen'
import { BackBar } from './BackBar'
import { NoteStats } from './NoteStats'
import { NoteCard } from './NoteCard'
import { ReplyComposer } from './ReplyComposer'
import { sessionPubkey, useSession } from './SessionProvider'
import { Threaded } from './Threaded'

/** Replies deeper than this stop indenting, so a long chain does not walk off. */

/** The route's entry point: unwrap the params promise, then hand the id to the view. */
export function ThreadScreen({ params }: { params: Promise<{ id: string }> }): React.ReactNode {
  const { id } = use(params)
  return <ThreadView id={id} />
}

export function ThreadView({
  id,
  onBack,
}: {
  id: string
  /** Close instead of navigate, for a thread that is not a page. */
  onBack?: () => void
}): React.ReactNode {
  const router = useRouter()
  const entity = useMemo(() => resolveEntity(id, 'event'), [id])
  const thread = useThread(entity?.hex, entity?.relays ?? [], entity?.author)
  const { session } = useSession()
  const viewer = sessionPubkey(session)

  /** A link to a REPOST opens the note that was reposted. */
  const unwrapped = useMemo(() => {
    if (thread.target === undefined || thread.target.kind !== KINDS.repost) return undefined
    const inner = displayedNote(thread.target).inner
    // An empty kind-6 whose original has not been fetched stands in for itself.
    return inner.id === thread.target.id ? undefined : inner
  }, [thread.target])

  /** A link to a REACTION opens the note that was reacted. */
  const reactedTo = useMemo(() => {
    if (thread.target === undefined || thread.target.kind !== KINDS.reaction) return undefined
    let target: string | undefined
    for (const tag of thread.target.tags) {
      if (tag[0] === 'e' && typeof tag[1] === 'string' && tag[1].length === 64) target = tag[1]
    }
    return target
  }, [thread.target])

  useEffect(() => {
    if (unwrapped !== undefined) router.replace(noteHref(unwrapped))
    else if (reactedTo !== undefined) router.replace(`/e/${reactedTo}`)
  }, [unwrapped, reactedTo, router])

  /** OPEN ON THE NOTE THAT WAS ASKED FOR, not on the conversation above. */
  const targetRef = useRef<HTMLDivElement>(null)
  const tookOver = useRef(false)
  const targetId = thread.target?.id
  const ancestorCount = thread.ancestors.length

  useEffect(() => {
    tookOver.current = false
  }, [targetId])

  useEffect(() => {
    if (targetId === undefined || ancestorCount === 0) return

    const settle = (): void => {
      if (tookOver.current) return
      targetRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
    }
    const stop = (): void => {
      tookOver.current = true
    }

    window.addEventListener('wheel', stop, { passive: true })
    window.addEventListener('touchstart', stop, { passive: true })
    window.addEventListener('keydown', stop)

    settle()
    const frame = requestAnimationFrame(settle)
    const timer = setTimeout(settle, 250)

    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      window.removeEventListener('wheel', stop)
      window.removeEventListener('touchstart', stop)
      window.removeEventListener('keydown', stop)
    }
  }, [targetId, ancestorCount])

  /** Muted replies fold, they do not vanish. */
  const [showFolded, setShowFolded] = useState(false)

  // One subscription covering the whole thread.
  const threadIds = useMemo(() => {
    const ids: string[] = []
    if (thread.target !== undefined) ids.push(thread.target.id)
    for (const event of thread.ancestors) ids.push(event.id)
    const walk = (nodes: ThreadNode[]): void => {
      for (const node of nodes) {
        ids.push(node.event.id)
        walk(node.children)
      }
    }
    walk(thread.replies)
    return ids
  }, [thread.target, thread.ancestors, thread.replies])
  /* A long-form target is reacted to by ADDRESS, not by id. */
  const addresses = useMemo(() => {
    const target = thread.target
    if (target === undefined || !isAddressable(target.kind)) return undefined
    return new Map([[eventAddress(target), target.id]])
  }, [thread.target])
  const { counts, zaps } = useInteractions(threadIds, addresses === undefined ? undefined : { addresses })

  /** The reader's own replies first, then the rest by how much the conversation engaged. */
  const ordered = useMemo(() => {
    const scoreOf = (node: ThreadNode): number => {
      const count = counts.get(node.event.id)
      if (count === undefined) return 0
      return engagementScore({
        replies: count.replies,
        reposts: count.reposts,
        quotes: count.quotes,
        reactions: count.likes,
        // Distinct zappers carry the weight.
        zapCount: count.zapCount ?? 0,
        zapSats: count.zapSats,
      })
    }
    const others = thread.replies.filter(node => node.event.pubkey !== viewer)
    // Ties broken by time, oldest first, so equally-quiet replies still read.
    const ranked = [...others].sort(
      (a, b) => scoreOf(b) - scoreOf(a) || a.event.created_at - b.event.created_at,
    )
    if (viewer === undefined) return ranked
    const mine = thread.replies.filter(node => node.event.pubkey === viewer)
    if (mine.length === 0) return ranked
    // Newest of your own first.
    const sortedMine = [...mine].sort((a, b) => b.event.created_at - a.event.created_at)
    return [...sortedMine, ...ranked]
  }, [thread.replies, viewer, counts])

  /** Replies from accounts with no profile at all, folded behind the disclosure. */
  const replyEvents = useMemo(() => ordered.map(node => node.event), [ordered])
  const replyGate = useProfileGate(replyEvents, {
    enabled: true,
    requireNip05: false,
    ...(viewer === undefined ? {} : { alwaysAllow: viewer }),
  })
  const lowSignal = useMemo(() => {
    const out = new Set<Hex>()
    for (const node of ordered) {
      if (!replyGate.accepts(node.event)) out.add(node.event.pubkey as Hex)
    }
    return out
  }, [ordered, replyGate])

  const ranked = useMemo(
    () =>
      rankReplies(ordered, {
        threadAuthor: thread.target?.pubkey,
        viewer,
        isLowSignal: (pubkey: Hex) => lowSignal.has(pubkey),
        /* A DECISION rather than a guess, so it is folded even when it is the only one. */
        isHidden: node =>
          advertisingReply(node.event as NostrEvent) ||
          // The reader's own filters.
          isMutedContent(node.event as NostrEvent),
      }),
    [ordered, thread.target?.pubkey, viewer, lowSignal],
  )

  /** The focused note asks for its OWN zaps, on its own budget. */
  const focusedZaps = useNoteZaps(thread.target)

  /** AND THE ZAPS ONLY THE READER'S OWN WALLET KNOWS. */
  const walletKnown = useWalletZaps(viewer, thread.target?.pubkey as Hex | undefined, true)
  const allZaps = useMemo(
    () => mergeWalletZaps(focusedZaps, walletKnown, thread.target?.id ?? ''),
    [focusedZaps, walletKnown, thread.target?.id],
  )
  const targetZaps = allZaps.length > 0 ? allZaps : zaps.get(thread.target?.id ?? '')

  /** The zap NUMBER on the focused note comes from the same place as the faces beside. */
  const targetCounts = useMemo(
    () => liftZapCounts(counts.get(thread.target?.id ?? ''), allZaps),
    [counts, allZaps, thread.target?.id],
  )

  if (entity === null) {
    return (
      <p className="px-4 py-8 text-center text-sm text-text-muted sm:px-5">
          That is not a note identifier. Links to a note look like <code>note1…</code> or{' '}
          <code>nevent1…</code>.
        </p>
    )
  }

  if (thread.missing) {
    return (
      <p className="px-4 py-8 text-center text-sm text-text-muted sm:px-5">
          None of the connected relays have this note. It may live on a relay we do not read,
          or it may have been deleted.
        </p>
    )
  }

  if (thread.target === undefined) {
    /* A SPINNER, not a sentence. */
    return (
      <div className="flex justify-center px-4 py-16 sm:px-5" role="status" aria-label="Loading note">
        <span
          aria-hidden="true"
          className="size-6 animate-spin rounded-full border-2 border-text border-t-transparent"
        />
      </div>
    )
  }

  /** An ARTICLE is not a note, and must not be rendered as one. */
  if (thread.target.kind === KINDS.longForm) {
    return (
      <ArticleScreen
        event={thread.target}
        counts={targetCounts}
        zaps={targetZaps}
      />
    )
  }

  return (
    <>
      {/* `← Note`, the way out. */}
      <div className="px-4 sm:px-5">
        <BackBar label="Note" href="/" {...(onBack === undefined ? {} : { onBack })} />
      </div>

      {thread.ancestors.length > 0 ? (
        <div>
          {thread.ancestors.map(event => (
            // Every ancestor is answered by the card beneath.
            <Threaded key={event.id} connected>
              <NoteCard event={event} counts={counts.get(event.id)} zaps={zaps.get(event.id)} />
            </Threaded>
          ))}
        </div>
      ) : null}

      {/* The note the reader actually asked. */}
      {/* `scroll-mt-14` clears the sticky BackBar, which is `top-0 z-20` and would otherwise. */}
      <div ref={targetRef} className="scroll-mt-14 bg-bg-elevated">
        {/* `unfolded`: the note's own page shows the note, not a preview with "Show more". */}
        <NoteCard
          event={thread.target}
          counts={targetCounts}
          zaps={targetZaps}
          unfolded
        />
        {/* Under the note it belongs to and inside its raised surface, so the timestamp. */}
        <NoteStats event={thread.target} />
      </div>

      <ReplyComposer parent={thread.target} />

      {ordered.length > 0 ? (
        <div>
          {ranked.shown.map(node => (
            <Reply key={node.event.id} node={node} depth={0} counts={counts} zaps={zaps} />
          ))}

          {ranked.folded.length === 0 ? null : showFolded ? (
            ranked.folded.map(node => (
              <Reply key={node.event.id} node={node} depth={0} counts={counts} zaps={zaps} />
            ))
          ) : (
            <button
              type="button"
              onClick={() => setShowFolded(true)}
              className="w-full cursor-pointer px-4 py-4 text-left text-sm text-text-muted transition-colors hover:bg-bg-inset sm:px-5"
            >
              {/* Wording covers both reasons now: muted accounts and accounts with nothing published. */}
              {ranked.folded.length} hidden {ranked.folded.length === 1 ? 'reply' : 'replies'} , 
              show
            </button>
          )}
        </div>
      ) : thread.loading ? null : (
        <p className="px-4 py-6 text-center text-sm text-text-faint sm:px-5">No replies yet.</p>
      )}
    </>
  )
}

function Reply({
  node,
  depth,
  counts,
  zaps,
}: {
  node: ThreadNode
  depth: number
  counts: Map<string, NoteCounts>
  zaps: Map<string, readonly ZapDetail[]>
}): React.ReactNode {
  const hasChildren = node.children.length > 0

  return (
    <>
      {/* FLAT. */}
      <Threaded connected={hasChildren}>
        <NoteCard event={node.event} counts={counts.get(node.event.id)} zaps={zaps.get(node.event.id)} />
      </Threaded>
      {node.children.map(child => (
        <Reply key={child.event.id} node={child} depth={depth + 1} counts={counts} zaps={zaps} />
      ))}
    </>
  )
}

/** Draws the thread rail beside a note. */
