'use client'

import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'

import { useUploads } from '../lib/upload'
import { EditorInsertDialog } from './EditorInsertDialog'
import { sessionPubkey, useSession } from './SessionProvider'

/** A rich text surface for writing articles. */

const TOOLS = [
  { icon: 'format_bold', label: 'Bold', key: 'bold' },
  { icon: 'format_italic', label: 'Italic', key: 'italic' },
  { icon: 'format_h1', label: 'Heading', key: 'h2' },
  { icon: 'format_h2', label: 'Subheading', key: 'h3' },
  { icon: 'format_quote', label: 'Quote', key: 'quote' },
  { icon: 'format_list_bulleted', label: 'Bulleted list', key: 'bullet' },
  { icon: 'format_list_numbered', label: 'Numbered list', key: 'ordered' },
  { icon: 'code', label: 'Code', key: 'code' },
  { icon: 'link', label: 'Link', key: 'link' },
  { icon: 'image', label: 'Image', key: 'image' },
  { icon: 'horizontal_rule', label: 'Divider', key: 'rule' },
] as const

type ToolKey = (typeof TOOLS)[number]['key']

/** Whether the caret is currently inside this kind of formatting. */
function isActive(editor: Editor, key: ToolKey): boolean {
  switch (key) {
    case 'bold':
      return editor.isActive('bold')
    case 'italic':
      return editor.isActive('italic')
    case 'h2':
      return editor.isActive('heading', { level: 2 })
    case 'h3':
      return editor.isActive('heading', { level: 3 })
    case 'quote':
      return editor.isActive('blockquote')
    case 'bullet':
      return editor.isActive('bulletList')
    case 'ordered':
      return editor.isActive('orderedList')
    case 'code':
      return editor.isActive('code')
    case 'link':
      return editor.isActive('link')
    default:
      return false
  }
}

function run(editor: Editor, key: ToolKey): void {
  // `focus()` first on every path: a toolbar button steals the selection, and a command.
  const chain = editor.chain().focus()
  switch (key) {
    case 'bold':
      chain.toggleBold().run()
      return
    case 'italic':
      chain.toggleItalic().run()
      return
    case 'h2':
      chain.toggleHeading({ level: 2 }).run()
      return
    case 'h3':
      chain.toggleHeading({ level: 3 }).run()
      return
    case 'quote':
      chain.toggleBlockquote().run()
      return
    case 'bullet':
      chain.toggleBulletList().run()
      return
    case 'ordered':
      chain.toggleOrderedList().run()
      return
    case 'code':
      chain.toggleCode().run()
      return
    case 'rule':
      chain.setHorizontalRule().run()
      return
    case 'link':
      // Unlinking is immediate.
      if (editor.isActive('link')) chain.unsetLink().run()
      return
    case 'image':
      return
  }
}

export function RichEditor({
  html,
  onChange,
  placeholder,
}: {
  html: string
  onChange: (html: string) => void
  placeholder: string
}): React.ReactNode {
  const { session } = useSession()
  const signer = session.status === 'signed' ? session.signer : undefined
  /** Body images get their own upload channel, separate from the cover's. */
  const uploads = useUploads()
  const [asking, setAsking] = useState<'link' | 'image' | null>(null)
  const inserted = useRef(new Set<string>())
  const editor = useEditor({
    /** Rendered only on the client. */
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        // Nothing renders an h1 inside an article body: the title field above IS the h1.
        heading: { levels: [2, 3, 4] },
        link: false,
      }),
      Link.configure({
        openOnClick: false, // Clicking a link while writing should place the caret, not navigate.
        autolink: true,
        protocols: ['http', 'https'],
      }),
      Image.configure({ inline: false }),
      Placeholder.configure({ placeholder }),
    ],
    content: html,
    editorProps: {
      attributes: {
        class: 'article-prose focus:outline-none',
        // A long article deserves the browser's own spellcheck.
        spellcheck: 'true',
      },
    },
    onUpdate: ({ editor: current }) => onChange(current.getHTML()),
  })

  /** The pressed states, and why they are SUBSCRIBED rather than simply read. */
  /** A finished upload lands in the document by itself. */
  useEffect(() => {
    if (editor === null) return
    for (const url of uploads.urls) {
      if (inserted.current.has(url)) continue
      inserted.current.add(url)
      editor.chain().focus().setImage({ src: url }).run()
      setAsking(null)
    }
  }, [uploads.urls, editor])

  const active = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current === null
        ? {}
        : Object.fromEntries(TOOLS.map(tool => [tool.key, isActive(current, tool.key)])),
  })

  /** The restored draft, pushed. */
  useEffect(() => {
    if (editor === null || html === '' || !editor.isEmpty) return
    editor.commands.setContent(html, { emitUpdate: false })
  }, [editor, html])

  return (
    <div className="mt-5">
      {/* STICKY, under the back bar. */}
      <div className="sticky top-[53px] z-10 flex flex-wrap items-center gap-0.5 border-y border-border bg-bg/85 py-1.5 backdrop-blur">
        {TOOLS.map(tool => {
          const pressed = active?.[tool.key] === true
          return (
            <button
              key={tool.key}
              type="button"
              // The editor must not lose its selection when the button takes focus.
              onMouseDown={event => event.preventDefault()}
              onClick={() => {
                if (editor === null) return
                // Both of these need an address before anything can happen, and adding a link.
                if (tool.key === 'image' || (tool.key === 'link' && !editor.isActive('link'))) {
                  setAsking(tool.key === 'image' ? 'image' : 'link')
                  return
                }
                run(editor, tool.key)
              }}
              aria-label={tool.label}
              aria-pressed={pressed}
              title={tool.label}
              className={`flex size-9 cursor-pointer items-center justify-center rounded-lg transition-colors ${
                pressed
                  ? 'bg-accent-subtle text-accent-text'
                  : 'text-text-muted hover:bg-bg-inset hover:text-text'
              }`}
            >
              <span className="material-symbols-outlined text-[20px]!" aria-hidden="true">
                {tool.icon}
              </span>
            </button>
          )
        })}
      </div>

      <EditorContent editor={editor} className="mt-3" />

      {asking === null ? null : (
        <EditorInsertDialog
          title={asking === 'link' ? 'Add a link' : 'Add an image'}
          urlLabel={asking === 'link' ? 'Link to' : 'Image address'}
          urlPlaceholder={asking === 'link' ? 'example.com/article' : 'https://…/photo.jpg'}
          {...(asking === 'link' ? { textLabel: 'Text (optional)' } : {})}
          busy={uploads.busy}
          {...(asking === 'image' && signer !== undefined
            ? { onPickFile: (files: FileList) => uploads.add(files, signer) }
            : {})}
          onClose={() => setAsking(null)}
          onSubmit={({ url, text }) => {
            if (editor === null) return
            const chain = editor.chain().focus()
            if (asking === 'image') {
              chain.setImage({ src: url }).run()
            } else if (text === '' || !editor.state.selection.empty) {
              // With a selection, the selected words become the link.
              chain.extendMarkRange('link').setLink({ href: url }).run()
            } else {
              /** Escaped, because this is the one place the editor builds MARKUP from typed text. */
              const escape = (value: string): string =>
                value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
              chain.insertContent(`<a href="${escape(url)}">${escape(text)}</a>`).run()
            }
            setAsking(null)
          }}
        />
      )}
    </div>
  )
}
