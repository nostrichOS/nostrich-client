import { createContext, useContext, useMemo } from 'react'

/** Where else this note's media might live. */
interface MediaContext {
  /** Servers the AUTHOR published (BUD-03), tried before any list of ours. */
  servers: readonly string[]
  /** Turn a media url into the host's own cached copy, when the host has one. */
  cacheUrl?: (url: string) => string
}

const EMPTY: MediaContext = { servers: [] }

const MediaServersContext = createContext<MediaContext>(EMPTY)

export function MediaServersProvider({
  servers,
  cacheUrl,
  children,
}: {
  servers: readonly string[]
  cacheUrl?: (url: string) => string
  children: React.ReactNode
}): React.ReactNode {
  const value = useMemo(() => ({ servers, ...(cacheUrl === undefined ? {} : { cacheUrl }) }), [servers, cacheUrl])
  return <MediaServersContext.Provider value={value}>{children}</MediaServersContext.Provider>
}

export function useMediaServers(): readonly string[] {
  return useContext(MediaServersContext).servers
}

/** The host's cached-copy builder, or undefined where there is no such thing. */
export function useMediaCacheUrl(): ((url: string) => string) | undefined {
  return useContext(MediaServersContext).cacheUrl
}
