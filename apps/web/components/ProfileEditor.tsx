'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { KINDS, profileToTemplate, type Hex, type Profile, type Signer } from '@nostrich/nostr'

import { getPool } from '../lib/pool'
import { BUTTON_PRIMARY, BUTTON_QUIET, CARD, INPUT_BASE, LINK } from '../lib/styles'
import { ContentLink } from './ContentLink'
import { useUploads } from '../lib/upload'
import { openModal } from '../lib/modal'
import { Avatar } from './Avatar'
import { MentionPicker } from './MentionPicker'
import { useMentionField } from '../lib/mentions'
import { mentionedPubkeys, toEditableBio } from '../lib/bio-mentions'
import { useMentionNames } from '../lib/profiles'

/** Editing your own kind-0. A profile on Nostr is one replaceable event, so saving. */

interface Fields {
  displayName: string
  name: string
  about: string
  website: string
  nip05: string
  lud16: string
  picture: string
  banner: string
}

function fieldsFrom(profile: Profile | null): Fields {
  return {
    displayName: profile?.displayName ?? '',
    name: profile?.name ?? '',
    about: profile?.about ?? '',
    website: profile?.website ?? '',
    nip05: profile?.nip05 ?? '',
    lud16: profile?.lud16 ?? '',
    picture: profile?.picture ?? '',
    banner: profile?.banner ?? '',
  }
}

/** Empty strings are omitted, not sent as "": a blank key is not the same as no key. */
function trimmed(value: string): string | undefined {
  const out = value.trim()
  return out === '' ? undefined : out
}

export function ProfileEditor({
  pubkey,
  profile,
  signer,
  onClose,
  onSaved,
}: {
  pubkey: Hex
  profile: Profile | null
  signer: Signer
  onClose: () => void
  onSaved: () => void
}): React.ReactNode {
  const ref = useRef<HTMLDialogElement>(null)
  const aboutRef = useRef<HTMLTextAreaElement>(null)
  /* The bio's `@name` bindings, seeded from nothing. */
  const mentions = useMentionField()
  const [fields, setFields] = useState<Fields>(() => fieldsFrom(profile))
  /** A bio arrives as keys and has to be edited as names. */
  const [aboutEdited, setAboutEdited] = useState(false)
  const bioMentions = useMemo(() => mentionedPubkeys(profile?.about ?? ''), [profile?.about])
  const bioNames = useMentionNames(bioMentions)
  const { remember } = mentions
  useEffect(() => {
    if (aboutEdited || bioMentions.length === 0) return
    const editable = toEditableBio(profile?.about ?? '', bioNames)
    remember(editable.bindings)
    setFields(current => (current.about === editable.text ? current : { ...current, about: editable.text }))
  }, [aboutEdited, bioMentions, bioNames, profile?.about, remember])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const avatarUploads = useUploads()
  const bannerUploads = useUploads()
  const avatarInput = useRef<HTMLInputElement>(null)
  const bannerInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const node = ref.current
    if (node === null) return
    openModal(node)
    return () => {
      if (node.open) node.close()
    }
  }, [])

  // An upload finishing writes its URL into the field, so the picture and banner behave.
  useEffect(() => {
    const url = avatarUploads.urls[0]
    if (url !== undefined) setFields(current => ({ ...current, picture: url }))
  }, [avatarUploads.urls])
  useEffect(() => {
    const url = bannerUploads.urls[0]
    if (url !== undefined) setFields(current => ({ ...current, banner: url }))
  }, [bannerUploads.urls])

  const set = (key: keyof Fields, value: string): void =>
    setFields(current => ({ ...current, [key]: value }))

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      /** Everything the previous kind-0 carried that this form does not model. */
      let preserve: Record<string, unknown> = {}
      try {
        const existing = await getPool().query([{ kinds: [KINDS.metadata], authors: [pubkey], limit: 1 }], undefined, 6_000)
        const newest = existing.sort((a, b) => b.created_at - a.created_at)[0]
        if (newest !== undefined) {
          const parsed: unknown = JSON.parse(newest.content)
          if (typeof parsed === 'object' && parsed !== null) preserve = parsed as Record<string, unknown>
        }
      } catch {
        // No previous profile, or it is unreadable.
      }

      /* EVERY FIELD THIS FORM OWNS IS SENT, empty ones as `''`. */
      const template = profileToTemplate(
        {
          pubkey,
          updatedAt: 0,
          displayName: trimmed(fields.displayName) ?? '',
          name: trimmed(fields.name) ?? '',
          /* `@name` as typed becomes `nostr:npub1…` here, at the one moment the author's choice. */
          about: trimmed(mentions.resolve(fields.about)) ?? '',
          website: trimmed(fields.website) ?? '',
          nip05: trimmed(fields.nip05) ?? '',
          lud16: trimmed(fields.lud16) ?? '',
          picture: trimmed(fields.picture) ?? '',
          banner: trimmed(fields.banner) ?? '',
        },
        { preserve },
      )

      const signed = await signer.signEvent(template)
      const results = await getPool().publish(signed)
      if (!results.some(result => result.ok)) {
        // The form stays open with the values intact so it can be retried rather than retyped.
        setError('No relay accepted the profile. Nothing was changed.')
        return
      }
      onSaved()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Signing was cancelled.')
    } finally {
      setBusy(false)
    }
  }

  const uploading = avatarUploads.busy || bannerUploads.busy

  return (
    <dialog
      /* Focusable so `openModal` can put the initial focus HERE rather than letting. */
      tabIndex={-1}
      ref={ref}
      onClose={onClose}
      onClick={event => {
        if (event.target === ref.current) onClose()
      }}
      aria-label="Edit profile"
      className={`${CARD} mx-auto mb-auto mt-[6vh] w-[min(600px,94vw)] p-0 backdrop:bg-black/60 open:animate-none`}
    >
      {/* Same close CONTROL as the composer. */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold text-text">Edit profile</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-2 flex size-9 items-center justify-center rounded-full text-text transition-colors hover:bg-border"
        >
          <span className="material-symbols-outlined text-[22px]!" aria-hidden="true">
            close
          </span>
        </button>
      </div>

      <div className="max-h-[70vh] overflow-y-auto">
        {/* Banner and avatar shown as they will appear, with the same overlap the profile page. */}
        <div className="relative">
          {fields.banner !== '' ? (
            /* eslint-disable-next-line @next/next/no-img-element -- arbitrary remote host */
            <img src={fields.banner} alt="" className="h-32 w-full bg-bg-inset object-cover" />
          ) : (
            <div className="h-32 w-full bg-gradient-to-br from-accent-subtle to-bg-inset" />
          )}
          <button
            type="button"
            onClick={() => bannerInput.current?.click()}
            disabled={busy}
            className="absolute right-3 top-3 rounded-full bg-black/55 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm hover:bg-black/70"
          >
            {bannerUploads.busy ? 'Uploading…' : 'Change cover'}
          </button>
          <input
            ref={bannerInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={event => {
              if (event.target.files !== null) bannerUploads.add(event.target.files, signer)
              event.target.value = ''
            }}
          />

          {/* Same 96px and the same overlap as the profile header, so the preview shows. */}
          <div className="absolute -bottom-10 left-4">
            <span className="relative block rounded-full ring-4 ring-bg-elevated">
              <Avatar pubkey={pubkey} name={fields.displayName || fields.name || 'You'} picture={fields.picture} size="xl" />
              <button
                type="button"
                onClick={() => avatarInput.current?.click()}
                disabled={busy}
                aria-label="Change profile picture"
                className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity hover:opacity-100"
              >
                <span className="material-symbols-outlined text-[20px]!" aria-hidden="true">
                  photo_camera
                </span>
              </button>
            </span>
            <input
              ref={avatarInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={event => {
                if (event.target.files !== null) avatarUploads.add(event.target.files, signer)
                event.target.value = ''
              }}
            />
          </div>
        </div>

        <div className="space-y-4 px-4 pb-4 pt-16">
          <Field label="Display name">
            <input value={fields.displayName} onChange={e => set('displayName', e.target.value)} maxLength={64} className={INPUT_BASE} />
          </Field>
          <Field label="Username">
            <input value={fields.name} onChange={e => set('name', e.target.value)} maxLength={64} className={INPUT_BASE} />
          </Field>
          <Field label="Bio">
            {/* THE SAME PICKER THE COMPOSER USES, for the same reason. */}
            <div className="relative">
              <textarea
                {...mentions.fieldProps}
                ref={aboutRef}
                value={fields.about}
                onChange={e => {
                  setAboutEdited(true)
                  set('about', e.target.value)
                  mentions.sync(e.currentTarget)
                }}
                onKeyUp={e => mentions.sync(e.currentTarget)}
                onClick={e => mentions.sync(e.currentTarget)}
                onBlur={() => mentions.dismiss()}
                rows={3}
                maxLength={1000}
                className={`${INPUT_BASE} resize-y`}
              />
              {mentions.query !== undefined ? (
                <MentionPicker
                  query={mentions.query}
                  viewer={pubkey}
                  onPick={(chosen, name) => {
                    setAboutEdited(true)
                    mentions.apply(aboutRef.current, aboutRef.current?.value ?? fields.about, chosen, name, next =>
                      set('about', next),
                    )
                  }}
                  onDismiss={mentions.dismiss}
                  onActive={mentions.announce}
                />
              ) : null}
            </div>
          </Field>
          <Field label="Website">
            <input value={fields.website} onChange={e => set('website', e.target.value)} placeholder="https://" className={INPUT_BASE} />
          </Field>
          <Field
            label="Verified Nostr Address (NIP-05)"
            /* Beside the label rather than under the input: a reader who does not have one. */
            aside={
              <ContentLink
                href="https://nostr.how/en/get-verified"
                className={`${LINK} text-sm font-medium`}
              >
                Get verified
              </ContentLink>
            }
          >
            <input value={fields.nip05} onChange={e => set('nip05', e.target.value)} placeholder="you@domain.com" className={`${INPUT_BASE} font-mono text-[16px]`} />
          </Field>
          <Field label="Lightning address">
            <input value={fields.lud16} onChange={e => set('lud16', e.target.value)} placeholder="you@wallet.com" className={`${INPUT_BASE} font-mono text-[16px]`} />
          </Field>

          {error !== null ? (
            <p role="alert" className="rounded-lg border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger-text">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <button type="button" onClick={onClose} className={BUTTON_QUIET}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || uploading}
          className={`${BUTTON_PRIMARY} disabled:cursor-not-allowed disabled:opacity-40`}
        >
          {busy ? 'Saving…' : uploading ? 'Uploading…' : 'Save'}
        </button>
      </div>
    </dialog>
  )
}

/** Label and control, no helper line. */
function Field({
  label,
  aside,
  children,
}: {
  label: string
  /** Optional control on the label's own line, right-aligned. */
  aside?: React.ReactNode
  children: React.ReactNode
}): React.ReactNode {
  return (
    <label className="block">
      <span className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-text">{label}</span>
        {aside}
      </span>
      {children}
    </label>
  )
}
