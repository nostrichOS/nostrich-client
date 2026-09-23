/** Public surface of @nostrich/ui. */

export * from './tokens'

import {
  ALL_THEME_CLASSES,
  DEFAULT_THEME,
  THEME_CLASSES,
  THEME_STORAGE_KEY,
  shadows,
  themes,
  type ColorRole,
  type ShadowKey,
  type ThemeName,
  type ThemeRoles,
} from './tokens'

/** Role variables are prefixed `--role-` and Tailwind's `--color-*` aliases. */
export const ROLE_VAR_PREFIX = '--role-'

const kebab = (key: string): string => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

/** e.g. `bgElevated` -> `--role-bg-elevated`. */
export function roleVarName(role: ColorRole): string {
  return `${ROLE_VAR_PREFIX}${kebab(role)}`
}

/** e.g. `bgElevated` -> `var(--role-bg-elevated)`, for inline styles and raw CSS. */
export function roleVar(role: ColorRole): string {
  return `var(${roleVarName(role)})`
}

/** e.g. `zapGlow` -> `--role-shadow-zap-glow`. */
export function shadowVarName(key: ShadowKey): string {
  return `${ROLE_VAR_PREFIX}shadow-${kebab(key)}`
}

export function shadowVar(key: ShadowKey): string {
  return `var(${shadowVarName(key)})`
}

/** The literal value, for the rare caller that needs a hex rather than a var reference. */
export function roleColor(theme: ThemeName, role: ColorRole): string {
  return themes[theme][role]
}

export function themeRoles(theme: ThemeName): ThemeRoles {
  return themes[theme]
}

export function oppositeTheme(theme: ThemeName): ThemeName {
  // One palette: there is nothing to flip.
  return theme
}

/** Every role variable for one theme, colours and shadows together, as a plain object. */
export function themeCssVariables(theme: ThemeName): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [role, value] of Object.entries(themes[theme])) {
    vars[`${ROLE_VAR_PREFIX}${kebab(role)}`] = value
  }
  for (const [key, value] of Object.entries(shadows[theme])) {
    vars[`${ROLE_VAR_PREFIX}shadow-${kebab(key)}`] = value
  }
  return vars
}

export interface CssTextOptions {
  /** Prefix for each declaration. Defaults to two spaces, matching theme.css. */
  indent?: string
}

/** The declarations only. */
export function themeCssText(theme: ThemeName, options: CssTextOptions = {}): string {
  const indent = options.indent ?? '  '
  return Object.entries(themeCssVariables(theme))
    .map(([name, value]) => `${indent}${name}: ${value};`)
    .join('\n')
}

export interface StylesheetOptions extends CssTextOptions {
  /** Selector holding the light theme. */
  lightSelector?: string
  /** Selector holding the dark theme. */
  darkSelector?: string
}

/** The palette as one stylesheet, mirroring theme.css. */
export function themeStylesheet(options: StylesheetOptions = {}): string {
  const light = options.lightSelector ?? ':root'
  return `${light} {\n${themeCssText('light', options)}\n}\n`
}

export function isThemeName(value: unknown): value is ThemeName {
  return value === 'light'
}

/** One palette, so this only ever answers `light`. */
export function resolveTheme(stored: unknown): ThemeName {
  return isThemeName(stored) ? stored : DEFAULT_THEME
}

/** Source for a synchronous inline `<script>` in `<head>`. */
export function themeInitScript(readerJs?: string): string {
  const key = JSON.stringify(THEME_STORAGE_KEY)
  // The whole map is inlined rather than branching on names in the script.
  const map = JSON.stringify(THEME_CLASSES)
  const all = JSON.stringify(ALL_THEME_CLASSES)
  const fallback = JSON.stringify(DEFAULT_THEME)
  return (
    `(function(){try{` +
    // A theme belongs to an ACCOUNT, so the host passes in a reader that resolves.
    `var m=${map},t=${readerJs === undefined ? `localStorage.getItem(${key})` : `(${readerJs})(${key})`};` +
    `if(!m[t])t=${fallback};` +
    `var r=document.documentElement;` +
    `r.classList.remove.apply(r.classList,${all});` +
    `if(m[t].length)r.classList.add.apply(r.classList,m[t]);` +
    `r.style.colorScheme="light";` +
    /* THE BROWSER'S OWN CHROME. */
    `var c=getComputedStyle(r).getPropertyValue("--role-bg").trim();` +
    `if(c){var q=document.querySelector('meta[name="theme-color"]');` +
    `if(!q){q=document.createElement("meta");q.setAttribute("name","theme-color");document.head.appendChild(q)}` +
    `q.setAttribute("content",c)}` +
    `}catch(e){}})();`
  )
}
