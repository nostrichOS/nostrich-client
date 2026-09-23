import { createContext, useContext, useMemo } from 'react'
import { StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native'
import {
  DEFAULT_THEME,
  fontSize,
  fontWeight,
  radius,
  spacing,
  themes,
  type ThemeName,
  type ThemeRoles,
} from '@nostrich/ui'

/** Theme access for every shared screen. */

export interface Theme extends ThemeRoles {
  name: ThemeName
}

const ThemeContext = createContext<Theme | null>(null)

export function ThemeProvider({
  children,
  theme,
}: {
  children: React.ReactNode
  /** Kept for callers that pass one. */
  theme?: ThemeName
}): React.ReactNode {
  const resolved: ThemeName = theme ?? DEFAULT_THEME
  const value = useMemo<Theme>(() => ({ ...themes[resolved], name: resolved }), [resolved])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext)
  if (theme === null) throw new Error('useTheme must be used inside <ThemeProvider>')
  return theme
}

/** Build a themed StyleSheet once per theme rather than on every render. */
/** A named style map, constrained to what React Native accepts. */
export type NamedStyles = Record<string, ViewStyle | TextStyle | ImageStyle>

export function makeStyles<T extends NamedStyles>(
  factory: (theme: Theme, t: Tokens) => T,
): (theme: Theme) => T {
  const cache = new Map<ThemeName, T>()
  return (theme: Theme) => {
    const hit = cache.get(theme.name)
    if (hit !== undefined) return hit
    const created = StyleSheet.create(factory(theme, tokens)) as T
    cache.set(theme.name, created)
    return created
  }
}

/** Non-colour scales, which do not change between themes. */
export interface Tokens {
  spacing: typeof spacing
  radius: typeof radius
  fontSize: typeof fontSize
  fontWeight: typeof fontWeight
}

export const tokens: Tokens = { spacing, radius, fontSize, fontWeight }

/** Convenience for the common `const s = useStyles(styles)` call in a screen. */
export function useStyles<T extends NamedStyles>(sheet: (theme: Theme) => T): T {
  return sheet(useTheme())
}
