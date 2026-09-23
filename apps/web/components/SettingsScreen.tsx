'use client'

import { useEffect, useState } from 'react'

import {
  DEFAULT_FONT_SIZE,
  FONT_SIZES,
  FONT_STORAGE_KEY,
  applyFontSize,
  currentFontSize,
  readStoredFontSize,
  type FontSize,
} from '../lib/font-size'
import {
  BADGE_PRESETS,
  DEFAULT_BADGE,
  DEFAULT_STYLE,
  setBadgeStyle,
  useBadgeStyle,
} from '../lib/badge-color'
import { DevToolsTab } from './DevToolsTab'
import { sessionPubkey, useSession } from './SessionProvider'
import { VerifiedBadge } from './VerifiedBadge'
import { setBookmarksPublic, useBookmarksPublic } from '../lib/bookmark-privacy'
import { useIsNativeShell } from '../lib/native-shell'
import { useTabParam } from '../lib/tab-param'
import { FiltersTab } from './FiltersTab'
import { Panel } from './SettingsPanel'
import { PAGE, PAGE_TITLE, TAB_ACTIVE, TAB_CELL_TIGHT, TAB_IDLE, TAB_LABEL, TAB_STRIP, TAB_STRIP_BLEED, TAB_STRIP_ROW_TIGHT, TAB_UNDERLINE } from '../lib/styles'
import { MediaServerSettings } from './MediaServerSettings'
import { RelaySettings } from './RelaySettings'

/** Settings, tabbed like the sign-in page. */

type TabId = 'appearance' | 'filters' | 'relays' | 'privacy' | 'dev'

const TABS: { id: TabId; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  /* Filters sits next to Appearance because both are about what the reader SEES. */
  { id: 'filters', label: 'Filters' },
  { id: 'relays', label: 'Relays' },
  /* The ID stays `privacy` while the LABEL does not: it is in the URL, and every link. */
  { id: 'privacy', label: 'Preferences' },
  { id: 'dev', label: 'Console' },
]

export function SettingsScreen(): React.ReactNode {
  const [tab, setTab] = useTabParam<TabId>(
    ['appearance', 'filters', 'relays', 'privacy', 'dev'],
    'appearance',
  )

  return (
    <div className={PAGE}>
      <h1 className={PAGE_TITLE}>Settings</h1>

      <div className={`mt-4 ${TAB_STRIP} ${TAB_STRIP_BLEED}`}>
        <div role="tablist" aria-label="Settings" className={TAB_STRIP_ROW_TIGHT}>
          {TABS.map(item => (
            <button
              key={item.id}
              role="tab"
              type="button"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              /* `TAB_CELL_TIGHT`, the documented rule for four or more tabs: four 7rem cells need. */
              className={TAB_CELL_TIGHT}
            >
              <span className={TAB_LABEL}>
                <span className={tab === item.id ? TAB_ACTIVE : TAB_IDLE}>
                  {item.label}
                </span>
                {/* Sits under the LABEL and takes its width, rather than a fixed w-12 centred. */}
                {tab === item.id ? (
                  <span
                    aria-hidden="true"
                    className={TAB_UNDERLINE}
                  />
                ) : null}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel" className="mt-5">
        {tab === 'appearance' ? (
          <AppearanceTab />
        ) : tab === 'privacy' ? (
          <PrivacyTab />
        ) : tab === 'filters' ? (
          <FiltersTab />
        ) : tab === 'relays' ? (
          /* Media servers sit under Relays: both answer "where do my things live", and a reader. */
          <>
            <RelaySettings />
            <MediaServerSettings />
          </>
        ) : (
          <DevToolsTab />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------.

/** What other people can see about what you do here. */
function PrivacyTab(): React.ReactNode {
  const isPublic = useBookmarksPublic()
  const inApp = useIsNativeShell()

  return (
    <div className="space-y-8">
      {/* IN THE APP ONLY, and inside a tab that already exists rather than as a sixth one. */}

      <section>
        <h2 className="text-[16px] font-semibold text-text">Bookmarks</h2>
        <p className="mb-3 text-[14px] text-text-faint">
          A bookmark list is a standard Nostr event. When published publicly, it is interoperable
          across Nostr and visible to other clients. When kept private, the list is encrypted to
          your own key and cannot be read by relays, other users, or clients that do not have
          access to your key, including Nostrich.
        </p>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
          <span>
            <span className="block text-[16px] font-semibold text-text">Public bookmarks</span>
            {/* "New bookmarks", not "bookmarks". */}
            <span className="block text-[14px] text-text-faint">
              New bookmarks are visible to anyone and notify the author. Turn this off to keep
              them encrypted and unreadable by anyone else.
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={isPublic}
            aria-label="Public bookmarks"
            onClick={() => setBookmarksPublic(!isPublic)}
            className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${
              isPublic ? 'bg-text' : 'bg-border-strong'
            }`}
          >
            <span
              aria-hidden="true"
              className={`absolute top-0.5 size-5 rounded-full bg-bg transition-all ${
                isPublic ? 'left-[22px]' : 'left-0.5'
              }`}
            />
          </button>
        </div>

      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------.

function AppearanceTab(): React.ReactNode {
  const { session } = useSession()
  const signedIn = sessionPubkey(session) !== undefined
  // Starts at the app default so the server HTML and the first client render agree.
  const [size, setSize] = useState<FontSize>(DEFAULT_FONT_SIZE)

  useEffect(() => {
    setSize(currentFontSize())

    // Two tabs open should not disagree about the preference.
    const onStorage = (event: StorageEvent): void => {
      if (event.key === FONT_STORAGE_KEY) {
        const stored = readStoredFontSize()
        applyFontSize(stored)
        setSize(stored)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return (
    /* `space-y-4`, not 8. The cards carry their own padding now, so the old gap left them. */
    <div className="space-y-4">
      <Panel
        title="Text size"
        description="Applies to notes and articles. Navigation and buttons stay the same size, so the layout does not shift around; use your browser zoom if you want everything larger."
      >
        {/* A ROW OF FOUR, OR A BLOCK OF TWO ON THE NARROWEST PHONES. */}
        <div className="grid grid-cols-2 gap-2 min-[360px]:grid-cols-4">
          {FONT_SIZES.map(option => (
            <button
              key={option.id}
              type="button"
              aria-pressed={size === option.id}
              onClick={() => {
                applyFontSize(option.id)
                setSize(option.id)
              }}
              /* `whitespace-nowrap`, and a step down in size on a phone. */
              className={`min-w-0 whitespace-nowrap rounded-lg border px-1.5 py-3 text-[15px] font-semibold transition-colors sm:px-2 sm:text-[16px] ${
                size === option.id
                  ? 'border-text bg-text text-bg'
                  : 'border-border text-text hover:bg-bg-inset'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* A live sample, not a number. */}
        <div className="mt-3 rounded-lg bg-bg-inset p-4">
          <p className="note-body text-[calc(1rem*var(--content-scale,1))] leading-[1.5] text-text">
            The quick brown fox jumps over the lazy dog. This is how a note will look at the
            size you picked.
          </p>
        </div>
      </Panel>

      {/* Signed out there is no "your badge" to colour: the preview renders the reader's own. */}
      {signedIn ? <BadgeSection /> : null}
    </div>
  )
}

/** The verified tick's colour. */
function BadgeSection(): React.ReactNode {
  const style = useBadgeStyle()
  const isPreset = BADGE_PRESETS.some(preset => preset.color.toLowerCase() === style.color.toLowerCase())

  return (
    <Panel
      title="Verified badge"
      description="The colour of the tick beside a verified name. What it means does not change, only how it looks to you, on this device."
    >
      <div className="mb-4 flex items-center gap-3 rounded-lg bg-bg-inset px-4 py-3">
        {/* `mine`. */}
        <VerifiedBadge size={22} mine />
        <span className="text-[16px] font-bold text-text">Preview</span>
        <span className="text-[14px] text-text-faint">
          {style.mode === 'gradient' ? 'Gradient' : isPreset ? 'Preset' : 'Custom'}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {BADGE_PRESETS.map(preset => {
          const active =
            style.mode === 'solid' && style.color.toLowerCase() === preset.color.toLowerCase()
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={active}
              aria-label={preset.label}
              title={preset.label}
              onClick={() => setBadgeStyle({ ...style, mode: 'solid', color: preset.color })}
              className={`size-9 cursor-pointer rounded-full border-2 transition-transform hover:scale-110 ${
                active ? 'border-text' : 'border-border'
              }`}
              style={{ backgroundColor: preset.color }}
            />
          )
        })}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-bg-inset px-4 py-3">
        <span>
          <span className="block text-[16px] font-semibold text-text">Gradient</span>
          <span className="block text-[14px] text-text-faint">Blend two colours across the tick.</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={style.mode === 'gradient'}
          aria-label="Gradient"
          onClick={() =>
            setBadgeStyle({ ...style, mode: style.mode === 'gradient' ? 'solid' : 'gradient' })
          }
          className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${
            style.mode === 'gradient' ? 'bg-text' : 'bg-border-strong'
          }`}
        >
          <span
            aria-hidden="true"
            className={`absolute top-0.5 size-5 rounded-full bg-bg transition-all ${
              style.mode === 'gradient' ? 'left-[22px]' : 'left-0.5'
            }`}
          />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-3">
        <ColorField
          label={style.mode === 'gradient' ? 'From' : 'Custom colour'}
          value={style.color}
          onChange={color => setBadgeStyle({ ...style, color })}
        />
        {/* The second stop is only shown in gradient mode, but its value is kept either way. */}
        {style.mode === 'gradient' ? (
          <ColorField
            label="To"
            value={style.colorB}
            onChange={colorB => setBadgeStyle({ ...style, colorB })}
          />
        ) : null}

        {style.color.toLowerCase() !== DEFAULT_BADGE || style.mode !== 'solid' ? (
          <button
            type="button"
            onClick={() => setBadgeStyle(DEFAULT_STYLE)}
            className="self-end rounded-lg border border-border px-3 py-2 text-[16px] text-text-muted transition-colors hover:bg-bg-inset hover:text-text"
          >
            Reset
          </button>
        ) : null}
      </div>
    </Panel>
  )
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (color: string) => void
}): React.ReactNode {
  const id = `badge-${label.replace(/\s+/g, '-').toLowerCase()}`
  return (
    <span className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[14px] text-text-faint">
        {label}
      </label>
      <span className="flex items-center gap-2">
        {/* The platform colour picker. */}
        <input
          id={id}
          type="color"
          value={value}
          onChange={event => onChange(event.target.value)}
          className="size-9 cursor-pointer rounded-lg border border-border bg-bg-elevated p-1"
        />
        <span className="font-mono text-xs uppercase text-text-muted">{value}</span>
      </span>
    </span>
  )
}
