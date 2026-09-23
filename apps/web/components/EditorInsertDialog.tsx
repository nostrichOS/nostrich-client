'use client'

import { useEffect, useRef, useState } from 'react'

import { openModal } from '../lib/modal'

/** Asking the writer for a URL, in the app rather than in the browser's chrome. */
export function EditorInsertDialog({
  title,
  urlLabel,
  urlPlaceholder,
  textLabel,
  initialText,
  onSubmit,
  onClose,
  onPickFile,
  busy = false,
}: {
  title: string
  urlLabel: string
  urlPlaceholder: string
  /** Shown only for links: the words the reader sees. */
  textLabel?: string
  initialText?: string
  onSubmit: (value: { url: string; text: string }) => void
  onClose: () => void
  /** Offered only where a file makes sense. */
  onPickFile?: (files: FileList) => void
  busy?: boolean
}): React.ReactNode {
  const ref = useRef<HTMLDialogElement>(null)
  const urlRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState('')
  const [text, setText] = useState(initialText ?? '')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Opens onto the URL box, because typing is what happens next.
    openModal(ref.current, urlRef.current)
  }, [])

  /** Schemes the editor will write into an article. */
  const ALLOWED = ['http:', 'https:', 'mailto:']

  const submit = (): void => {
    const trimmed = url.trim()
    if (trimmed === '') return
    // Bare domains are what people type.
    const href = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`

    const scheme = /^([a-z][a-z0-9+.-]*:)/i.exec(href)?.[1]?.toLowerCase()
    if (scheme === undefined || !ALLOWED.includes(scheme)) {
      setError('That address cannot be linked. Use http, https or mailto.')
      return
    }
    onSubmit({ url: href, text: text.trim() })
  }

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      onClose={onClose}
      onClick={event => {
        if (event.target === ref.current) onClose()
      }}
      aria-label={title}
      className="m-auto w-[min(420px,calc(100vw-2rem))] rounded-2xl border border-border bg-bg-elevated p-0 text-text shadow-lg backdrop:bg-black/40"
    >
      <form
        method="dialog"
        onSubmit={event => {
          event.preventDefault()
          submit()
        }}
        className="p-4"
      >
        <h2 className="text-lg font-bold">{title}</h2>

        {onPickFile === undefined ? null : (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={event => {
                if (event.target.files !== null && event.target.files.length > 0) {
                  onPickFile(event.target.files)
                }
                event.target.value = ''
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="mt-3 flex w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border px-4 py-6 text-text-muted transition-colors hover:bg-bg-inset disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[26px]!" aria-hidden="true">
                add_photo_alternate
              </span>
              <span className="text-sm font-semibold">{busy ? 'Uploading…' : 'Upload an image'}</span>
              {/* Said plainly, because it is unusual and it is the point: the bytes never reach. */}
              <span className="text-xs text-text-faint">Goes straight to a Blossom host, not to us</span>
            </button>

            <p className="mt-3 text-center text-xs text-text-faint">or paste an address</p>
          </>
        )}

        <label className="mt-3 block text-sm font-semibold text-text-muted" htmlFor="editor-url">
          {urlLabel}
        </label>
        <input
          id="editor-url"
          ref={urlRef}
          value={url}
          onChange={event => {
            setUrl(event.target.value)
            setError(null)
          }}
          placeholder={urlPlaceholder}
          autoComplete="off"
          spellCheck={false}
          className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
        />

        {error === null ? null : (
          <p role="alert" className="mt-2 text-sm text-danger-text">
            {error}
          </p>
        )}

        {textLabel === undefined ? null : (
          <>
            <label className="mt-3 block text-sm font-semibold text-text-muted" htmlFor="editor-text">
              {textLabel}
            </label>
            <input
              id="editor-text"
              value={text}
              onChange={event => setText(event.target.value)}
              placeholder="The words the reader sees"
              className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
            />
          </>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-full border border-border px-4 py-1.5 text-[15px] font-bold text-text-muted transition-colors hover:bg-bg-inset hover:text-text"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={url.trim() === ''}
            className="cursor-pointer rounded-full border border-transparent bg-text px-4 py-1.5 text-[15px] font-bold text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Insert
          </button>
        </div>
      </form>
    </dialog>
  )
}
