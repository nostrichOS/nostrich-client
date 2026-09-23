'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { buildLongForm, encodeNaddr, type NostrEvent } from '@nostrich/nostr'

import { htmlToMarkdown, textOf } from '../lib/html-to-markdown'
import { readingMinutes } from '../lib/markdown'
import { getPool } from '../lib/pool'
import { PAGE } from '../lib/styles'
import { MediaGateNotice } from './MediaGateNotice'
import { useUploads } from '../lib/upload'
import { BackBar } from './BackBar'
import { MarkdownBody } from './MarkdownBody'
import { RichEditor } from './RichEditor'
import { sessionPubkey, useSession } from './SessionProvider'

/** Writing a NIP-23 article. */

/** One draft, because this editor writes one article at a time. */
// The KEY keeps the old name on purpose.
const DRAFT_KEY = 'nostrich:reads-draft:v2'

interface Draft {
  title: string
  summary: string
  image: string
  hashtags: string[]
  content: string
}

const EMPTY: Draft = { title: '', summary: '', image: '', hashtags: [], content: '' }

function readDraft(): Draft {
  if (typeof window === 'undefined') return EMPTY
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (raw === null) return EMPTY
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return EMPTY
    const draft = parsed as Partial<Draft>
    return {
      title: typeof draft.title === 'string' ? draft.title : '',
      summary: typeof draft.summary === 'string' ? draft.summary : '',
      image: typeof draft.image === 'string' ? draft.image : '',
      hashtags: Array.isArray(draft.hashtags) ? draft.hashtags.filter(t => typeof t === 'string') : [],
      content: typeof draft.content === 'string' ? draft.content : '',
    }
  } catch {
    // Unreadable draft is a blank one.
    return EMPTY
  }
}

export function ArticleEditor(): React.ReactNode {
  const router = useRouter()
  const { session } = useSession()
  const pubkey = sessionPubkey(session)
  const signer = session.status === 'signed' ? session.signer : undefined
  const uploads = useUploads()

  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [restored, setRestored] = useState(false)
  const [tagDraft, setTagDraft] = useState('')
  const [preview, setPreview] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const coverInput = useRef<HTMLInputElement>(null)

  /** Restored after mount, never during render. */
  useEffect(() => {
    setDraft(readDraft())
    setRestored(true)
  }, [])

  useEffect(() => {
    if (!restored) return
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    } catch {
      // Private mode or a full quota.
    }
  }, [draft, restored])

  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void =>
    setDraft(current => ({ ...current, [key]: value }))

  /** Derived ONCE, from the first title typed. */
  const identifier = useMemo(() => {
    const slug = draft.title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 48)
    const tail = Math.random().toString(36).slice(2, 8)
    return slug === '' ? `article-${tail}` : `${slug}-${tail}`
    // eslint-disable-next-line react-hooks/exhaustive-deps -- identity must not track the title
  }, [draft.title === ''])

  // An uploaded cover wins over a pasted URL, because uploading is the more recent.
  const cover = uploads.urls[0] ?? draft.image

  /** Counted from the prose, converted only when there is something to convert. */
  const text = useMemo(() => textOf(draft.content), [draft.content])
  const markdown = useMemo(
    () => (text === '' ? '' : htmlToMarkdown(draft.content)),
    [draft.content, text],
  )
  const words = text === '' ? 0 : text.split(/\s+/).length
  const canPublish =
    signer !== undefined && draft.title.trim() !== '' && text !== '' && !publishing && !uploads.busy

  const addTag = (raw: string): void => {
    const tag = raw.replace(/^#/, '').trim().toLowerCase()
    if (tag === '' || draft.hashtags.includes(tag) || draft.hashtags.length >= 8) return
    set('hashtags', [...draft.hashtags, tag])
  }

  const takeCover = (files: FileList | File[] | null): void => {
    if (files === null || signer === undefined) return
    const list = [...files].filter(file => file.type.startsWith('image/'))
    if (list.length > 0) uploads.add([list[0] as File], signer)
  }

  const publish = async (): Promise<void> => {
    if (!canPublish || signer === undefined) return
    setPublishing(true)
    setError(null)
    try {
      const signed: NostrEvent = await signer.signEvent(
        buildLongForm({
          identifier,
          content: markdown,
          title: draft.title.trim(),
          ...(draft.summary.trim() === '' ? {} : { summary: draft.summary.trim() }),
          ...(cover.trim() === '' ? {} : { image: cover.trim() }),
          hashtags: draft.hashtags,
        }),
      )
      const results = await getPool().publish(signed)
      if (!results.some(result => result.ok)) {
        throw new Error('No relay accepted the article. It was not published.')
      }
      try {
        localStorage.removeItem(DRAFT_KEY)
      } catch {
        // Nothing to clean up.
      }
      /** Straight to the article, by ADDRESS rather than by id. */
      router.push(`/e/${encodeNaddr({ kind: 30_023, pubkey: signed.pubkey, identifier })}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not publish the article.')
      setPublishing(false)
    }
  }

  if (pubkey === undefined) {
    return (
      <div className={PAGE}>
        <BackBar label="Articles" href="/articles" />
        <p className="mt-6 text-sm leading-relaxed text-text-muted">
          Sign in to write an article. Long-form on Nostr is signed with your key, the same as a
          note.
        </p>
      </div>
    )
  }

  return (
    <div className={PAGE}>
      {/* THE ONLY CHROME on this page is this one row. */}
      <BackBar
        label="Articles"
        href="/articles"
        actions={
          <>
            {/* A toggle rather than a split pane: at 600px, side by side gives each half 300px. */}
            <button
              type="button"
              onClick={() => setPreview(current => !current)}
              aria-pressed={preview}
              className="cursor-pointer rounded-full border border-border px-4 py-1.5 text-[15px] font-bold text-text-muted transition-colors hover:bg-bg-inset hover:text-text"
            >
              {preview ? 'Edit' : 'Preview'}
            </button>
            <button
              type="button"
              disabled={!canPublish}
              onClick={() => void publish()}
              className="cursor-pointer rounded-full border border-transparent bg-text px-4 py-1.5 text-[15px] font-bold text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {publishing ? 'Publishing…' : 'Publish'}
            </button>
          </>
        }
      />

      {error !== null ? (
        <p
          role="alert"
          className="mt-3 rounded-md border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger-text"
        >
          {error}
        </p>
      ) : null}

      {preview ? (
        <article className="mt-6">
          <h1 className="text-3xl font-bold leading-tight tracking-tight text-text sm:text-[38px]">
            {draft.title.trim() === '' ? 'Untitled' : draft.title}
          </h1>
          {draft.summary.trim() === '' ? null : (
            <p className="mt-3 text-lg leading-relaxed text-text-muted">{draft.summary}</p>
          )}
          {cover === '' ? null : (
            // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote host
            <img
              src={cover}
              alt=""
              referrerPolicy="no-referrer"
              className="mt-6 h-auto max-h-[520px] w-full rounded-xl bg-bg-inset object-contain"
            />
          )}
          <div className="mt-7">
            {/* The converted Markdown, not the editor's HTML. */}
            <MarkdownBody source={markdown} />
          </div>
        </article>
      ) : (
        <div className="mt-5">
          {/* COVER. */}
          <input
            ref={coverInput}
            type="file"
            accept="image/*"
            hidden
            onChange={event => {
              takeCover(event.target.files)
              event.target.value = ''
            }}
          />
          <div
            onDragOver={event => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={event => {
              event.preventDefault()
              setDragging(false)
              takeCover(event.dataTransfer.files)
            }}
            className={`relative overflow-hidden rounded-xl border border-dashed transition-colors ${
              dragging ? 'border-accent bg-bg-inset' : 'border-border'
            }`}
          >
            {cover === '' ? (
              <button
                type="button"
                onClick={() => coverInput.current?.click()}
                className="flex w-full cursor-pointer flex-col items-center justify-center gap-1 px-4 py-10 text-text-muted transition-colors hover:bg-bg-inset"
              >
                <span className="material-symbols-outlined text-[28px]!" aria-hidden="true">
                  add_photo_alternate
                </span>
                <span className="text-sm font-semibold">
                  {uploads.busy ? 'Uploading…' : 'Add a cover image'}
                </span>
                <span className="text-xs text-text-faint">Click, or drop one here</span>
              </button>
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary remote host. */}
                <img
                  src={cover}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="h-auto max-h-[520px] w-full bg-bg-inset object-contain"
                />
                <button
                  type="button"
                  onClick={() => {
                    uploads.clear()
                    set('image', '')
                  }}
                  aria-label="Remove cover image"
                  className="absolute right-2 top-2 flex size-8 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition-colors hover:bg-black/75"
                >
                  <span className="material-symbols-outlined text-[18px]!" aria-hidden="true">
                    close
                  </span>
                </button>
              </>
            )}
          </div>
          <MediaGateNotice refusal={uploads.refusal} />

          {/* TITLE. */}
          <input
            value={draft.title}
            onChange={event => set('title', event.target.value)}
            placeholder="Title"
            className="mt-5 w-full bg-transparent text-3xl font-bold leading-tight tracking-tight text-text placeholder:text-text-faint focus:outline-none sm:text-[38px]"
          />

          <input
            value={draft.summary}
            onChange={event => set('summary', event.target.value)}
            placeholder="A one-line summary, shown on the Articles list"
            className="mt-3 w-full bg-transparent text-lg leading-relaxed text-text-muted placeholder:text-text-faint focus:outline-none"
          />

          {/* THE ARTICLE. */}
          <RichEditor
            html={draft.content}
            onChange={value => set('content', value)}
            placeholder="Tell your story…"
          />

          {/* The count sits under the writing rather than above it: it is something to glance. */}
          <p className="mt-3 text-sm text-text-faint">
            {words === 0
              ? 'Draft'
              : `${words.toLocaleString()} words · ${readingMinutes(markdown)} min read`}
          </p>

          {/* TAGS as chips, not a comma-separated string. */}
          <div className="mt-4 border-t border-border pt-4">
            <div className="flex flex-wrap items-center gap-2">
              {draft.hashtags.map(tag => (
                <span
                  key={tag}
                  className="flex items-center gap-1 rounded-lg bg-bg-inset py-1 pl-2.5 pr-1 text-sm text-text-muted"
                >
                  #{tag}
                  <button
                    type="button"
                    onClick={() => set('hashtags', draft.hashtags.filter(item => item !== tag))}
                    aria-label={`Remove ${tag}`}
                    className="flex size-5 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-border"
                  >
                    <span className="material-symbols-outlined text-[14px]!" aria-hidden="true">
                      close
                    </span>
                  </button>
                </span>
              ))}
              <input
                value={tagDraft}
                onChange={event => setTagDraft(event.target.value)}
                onKeyDown={event => {
                  // Enter or comma commits.
                  if (event.key === 'Enter' || event.key === ',') {
                    event.preventDefault()
                    addTag(tagDraft)
                    setTagDraft('')
                  } else if (event.key === 'Backspace' && tagDraft === '') {
                    set('hashtags', draft.hashtags.slice(0, -1))
                  }
                }}
                onBlur={() => {
                  addTag(tagDraft)
                  setTagDraft('')
                }}
                placeholder={draft.hashtags.length === 0 ? 'Add topics: news, nostr, bitcoin, etc...' : 'Add another'}
                /* 16px: anything smaller and iOS zooms the editor on focus and stays there. */
                className="min-w-[10rem] flex-1 bg-transparent py-1 text-[16px] text-text placeholder:text-text-faint focus:outline-none"
              />
            </div>
          </div>

        </div>
      )}
    </div>
  )
}
