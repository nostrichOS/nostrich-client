/** THE ONE HOST PARSER AND THE ONE HOST MATCHER. */

/** Hostname without a leading `www.`, lowercased, or undefined for anything unparseable. */
export function hostOf(url: string | undefined): string | undefined {
  if (url === undefined || url.trim() === '') return undefined
  try {
    return new URL(url.trim()).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return undefined
  }
}

/** The host itself or a subdomain of it, and NOTHING else. */
export function underDomain(host: string, domains: ReadonlySet<string>): boolean {
  if (domains.has(host)) return true
  for (const domain of domains) if (host.endsWith(`.${domain}`)) return true
  return false
}
