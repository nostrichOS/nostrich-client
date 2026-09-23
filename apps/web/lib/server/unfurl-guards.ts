/** The two ways a page can answer this server without being the page. */

/** Is this "title" just the site's own domain. */
export function isBareHost(title: string | undefined, target: URL): boolean {
  if (title === undefined) return false
  const cleaned = title.trim().toLowerCase().replace(/^www\./, '')
  const host = target.hostname.toLowerCase().replace(/^www\./, '')
  return cleaned === host || cleaned === `${host}/`
}

/** The titles bot walls give themselves. */
const CHALLENGE_TITLES: readonly RegExp[] = [
  /^client challenge$/,
  /^just a moment/,
  /^attention required/,
  /^access denied/,
  /^access to this page has been denied/,
  /^checking your browser/,
  /^one moment,? please/,
  /^please wait\b/,
  /^pardon our interruption/,
  /^request unsuccessful/,
  /^security check/,
  /^bot verification/,
  /^are you a (human|robot)/,
  /^(verify|confirm) (that )?you are (a )?human/,
  /^human verification/,
  /^captcha/,
  /^error 15\d\d/,
  /^ddos[- ]guard/,
]

/** The fingerprints of the walls themselves, for the ones that do not announce. */
const CHALLENGE_MARKERS: readonly string[] = [
  '/_fs-ch-', // F5 / Shape Security, lemonde.fr
  '_incapsula_resource', // Imperva
  'cf-browser-verification', // Cloudflare
  'cf_chl_opt', // Cloudflare managed challenge
  'captcha-delivery.com', // DataDome
  'px-captcha', // PerimeterX / HUMAN
  'distil_r_captcha', // Distil
  '/cdn-cgi/challenge-platform', // Cloudflare bot management, block page AND ordinary page
]

/** What a real page has and an interstitial never does. */
function hasOpenGraph(html: string): boolean {
  return /property=["']og:(title|image|description)["']/i.test(html)
}

/** Whether what came back is a wall rather than the page. */
export function looksLikeChallenge(html: string, title: string | undefined): boolean {
  const cleaned = (title ?? '').trim().toLowerCase().replace(/[…\s]+$/, '')
  // A page that titles itself "Client Challenge" is one, whatever else it carries.
  if (cleaned !== '' && CHALLENGE_TITLES.some(pattern => pattern.test(cleaned))) return true
  // A vendor's fingerprint counts only on a document with nothing to share.
  if (hasOpenGraph(html)) return false
  const haystack = html.toLowerCase()
  return CHALLENGE_MARKERS.some(marker => haystack.includes(marker))
}
