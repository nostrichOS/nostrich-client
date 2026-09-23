/** Shared utility strings, built from the @nostrich/ui role tokens. */

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50'

/** The primary action. */
export const BUTTON_PRIMARY = `${BUTTON_BASE} bg-text text-bg hover:opacity-90`

export const BUTTON_QUIET = `${BUTTON_BASE} border border-border-strong bg-bg-elevated text-text hover:bg-bg-inset`

/** The one that destroys something. */
export const BUTTON_DANGER = `${BUTTON_BASE} border border-danger-border bg-danger-surface text-danger-text hover:bg-danger-border`

export const BUTTON_GHOST = `${BUTTON_BASE} text-text-muted hover:bg-bg-inset hover:text-text`

export const CARD = 'rounded-lg border border-border bg-bg-elevated shadow-sm'

export const INPUT_BASE =
  /* `focus-visible:outline-text` overrides the global lavender focus ring for form. */
  /* 16px, AND THAT NUMBER IS NOT A STYLE CHOICE. */
  'w-full rounded-lg border border-border-strong bg-bg px-3 py-2 text-[16px] text-text placeholder:text-text-faint focus-visible:outline-text'

/** Inline links in prose. */
/** Interactive text: links, hashtags, mentions. */
/* `decoration-1` and a 3px offset, both stated rather than left to the browser. */
export const LINK =
  'text-link font-semibold underline decoration-1 decoration-transparent underline-offset-[3px] transition-colors hover:decoration-current'

/** The same link when it carries an ICON as well as text. */
export const LINK_WITH_ICON = 'group text-link font-semibold transition-colors'
export const LINK_LABEL =
  'underline decoration-1 decoration-transparent underline-offset-[3px] group-hover:decoration-current'

/** Standard inset for routes that are not the feed. */
export const PAGE = 'px-4 pt-4 pb-8 sm:px-5 sm:pt-[17px]'

/** A row inside a `PAGE` whose rule must span the whole column. */
export const COLUMN_ROW = '-mx-4 px-4 sm:-mx-5 sm:px-5'

/** THE settings type scale. */
export const SETTINGS_TITLE = 'text-[17px] font-bold text-text'
export const SETTINGS_BODY = 'text-[16px] leading-relaxed text-text-muted'
export const SETTINGS_LABEL = 'text-[16px] font-semibold text-text'
export const SETTINGS_HINT = 'text-[14px] text-text-faint'

/** A ROW OF RANGE PILLS. */
export const PILL_ROW = 'no-scrollbar flex items-center gap-1 overflow-x-auto'
export const PILL_BASE =
  'shrink-0 cursor-pointer whitespace-nowrap rounded-full px-2.5 py-1.5 text-[13px] font-bold transition-colors sm:px-3.5'
/** Selected. */
export const PILL_ON = 'bg-text text-bg'
export const PILL_OFF = 'border border-border text-text hover:bg-bg-inset'

/** The one page heading style. */
export const PAGE_TITLE = 'font-brand text-[28px] font-bold leading-[1.15] tracking-tight text-text'

/** Timeline copy that follows the reader's text-size setting. */
export const SCALED_BODY = 'text-[calc(0.875rem*var(--content-scale,1))]'

/** THE tab strip. */
export const TAB_STRIP = 'no-scrollbar flex overflow-x-auto border-b border-border'
/* The rule bleeds. */
export const TAB_STRIP_BLEED = '-mx-4 sm:-mx-5'
/** Inset to the column, so the tabs line up with whatever is drawn below them. */
export const TAB_STRIP_ROW = 'flex min-w-full px-4 sm:px-5'

/** The row for a FOUR-OR-FIVE tab strip: ends on the column, equal air. */
export const TAB_STRIP_ROW_TIGHT = 'flex min-w-full justify-between px-4 sm:px-5'

/** The cell, split in two the way `FeedScreen` splits it: the outer box owns. */
export const TAB_BOX = 'flex min-w-[7rem] flex-1 shrink-0'
export const TAB_INNER =
  'relative flex flex-1 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap py-3.5 text-[15px] transition-colors hover:bg-bg-inset'

/** The same cell as one element, for the strips whose tabs are plain `<button. */
/* The END tabs align with the column. */
/** The hover fill on the OUTER two tabs, run out to the strip's own edge. */
export const TAB_EDGE_FILL =
  'first:hover:shadow-[-1rem_0_0_0_var(--color-bg-inset)] last:hover:shadow-[1rem_0_0_0_var(--color-bg-inset)] sm:first:hover:shadow-[-1.25rem_0_0_0_var(--color-bg-inset)] sm:last:hover:shadow-[1.25rem_0_0_0_var(--color-bg-inset)]'

export const TAB_CELL =
  `relative flex min-w-[7rem] flex-1 shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap py-3.5 text-[15px] transition-[color,background-color,box-shadow] hover:bg-bg-inset ${TAB_EDGE_FILL}`
/* No `flex-1`: the cell is as wide as its label, and `TAB_STRIP_ROW_TIGHT`. */
export const TAB_CELL_TIGHT =
  `relative flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap px-1 sm:px-3 first:pl-0 last:pr-0 py-3.5 text-[15px] transition-[color,background-color,box-shadow] hover:bg-bg-inset ${TAB_EDGE_FILL}`

/** The marker, and the box it measures itself. */
export const TAB_LABEL = 'relative flex h-5 items-center'
export const TAB_UNDERLINE = 'absolute -bottom-3.5 left-0 right-0 h-1 rounded-lg bg-text'
export const TAB_ACTIVE = 'font-bold text-text'
export const TAB_IDLE = 'font-medium text-text-muted'
