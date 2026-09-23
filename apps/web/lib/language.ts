/** Which language a piece of writing is in, well enough to filter a feed. */

export type LanguageCode =
  | 'en'
  | 'es'
  | 'pt'
  | 'fr'
  | 'de'
  | 'it'
  | 'nl'
  | 'other'
  | 'ru'
  | 'uk'
  | 'ja'
  | 'zh'
  | 'ko'
  | 'ar'
  | 'he'
  | 'el'
  | 'hi'
  | 'th'
  | 'tr'
  | 'unknown'

export const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  en: 'English',
  es: 'Spanish',
  pt: 'Portuguese',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  nl: 'Dutch',
  other: 'Other',
  ru: 'Russian',
  uk: 'Ukrainian',
  ja: 'Japanese',
  zh: 'Chinese',
  ko: 'Korean',
  ar: 'Arabic',
  he: 'Hebrew',
  el: 'Greek',
  hi: 'Hindi',
  th: 'Thai',
  tr: 'Turkish',
  unknown: 'Unknown',
}

/** What each language calls itself. */
export const LANGUAGE_ENDONYMS: Partial<Record<LanguageCode, string>> = {
  en: 'English',
  es: 'Español',
  pt: 'Português',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
  nl: 'Nederlands',
  ru: 'Русский',
  uk: 'Українська',
  ja: '日本語',
  zh: '中文',
  ko: '한국어',
  ar: 'العربية',
  he: 'עברית',
  el: 'Ελληνικά',
  hi: 'हिन्दी',
  th: 'ไทย',
  tr: 'Türkçe',
}

/** True when an article should survive the reader's chosen language. */
export function matchesLanguage(code: LanguageCode, selected: LanguageCode | 'all'): boolean {
  if (selected === 'all') return true
  return code === selected || code === 'unknown'
}

/** Scripts, tested before any stopword work. */
const SCRIPTS: { code: LanguageCode; re: RegExp }[] = [
  { code: 'ru', re: /[Ѐ-ӿ]/g },
  { code: 'el', re: /[Ͱ-Ͽ]/g },
  { code: 'ar', re: /[؀-ۿݐ-ݿ]/g },
  { code: 'he', re: /[֐-׿]/g },
  { code: 'hi', re: /[ऀ-ॿ]/g },
  { code: 'th', re: /[฀-๿]/g },
  { code: 'ko', re: /[가-힯ᄀ-ᇿ]/g },
  { code: 'ja', re: /[぀-ヿ]/g },
  { code: 'zh', re: /[一-鿿]/g },
]

const UKRAINIAN_LETTERS = /[іїєґІЇЄҐ]/

const LATIN_RE = /[A-Za-zÀ-ÖØ-öø-ÿ]/g

/** Function words per language. */
const STOPWORDS: { code: LanguageCode; words: Set<string> }[] = [
  {
    code: 'en',
    words: new Set([
      'the','and','is','to','of','in','that','it','for','on','with','as','was','are','this',
      'be','have','has','not','but','they','you','from','at','or','an','we','can','will','all',
      'there','their','what','when','which','how','more','about','been','if','would','one',
    ]),
  },
  {
    code: 'es',
    words: new Set([
      'de','el','los','las','una','con','para','pero','más','sus','muy','este','esta','cuando',
      'porque','también','sin','sobre','hasta','entre','desde','como','que','por','del','al',
      'lo','ya','son','está','ser','hay','todo','puede','así','donde','tiene',
    ]),
  },
  {
    code: 'pt',
    /** The articles and prepositions were missing, and that is why Portuguese vanished. */
    words: new Set([
      'de','da','do','das','dos','em','na','no','nas','nos','os','as','ao','aos',
      'um','uma','não','com','para','mais','mas','ele','ela','você','muito','quando',
      'porque','também','sobre','até','entre','desde','isso','seu','sua','já','ser','são',
      'está','pode','como','que','por','nós','pelo','pela','ainda','fazer','foi','tem',
    ]),
  },
  {
    code: 'fr',
    words: new Set([
      'le','la','les','des','du','et','une','est','que','qui','dans','pour','sur','pas','ne',
      'avec','plus','ce','il','au','aux','sont','nous','vous','mais','par','son','ses','tout',
      'être','cette','comme','même','fait','peut',
    ]),
  },
  {
    code: 'de',
    words: new Set([
      'der','die','das','und','ist','den','von','zu','mit','sich','des','auf','für','nicht',
      'ein','eine','dem','als','auch','es','an','werden','aus','er','hat','dass','sie','nach',
      'bei','um','noch','wie','über','oder','aber','vor','durch','man','sein','wurde',
    ]),
  },
  {
    code: 'it',
    words: new Set([
      'il','la','di','che','un','in','per','non','una','con','sono','del','da','come','ma',
      'si','dei','gli','nel','alla','più','anche','questo','sua','suo','delle','della','delle',
      'essere','fare','molto','quando','perché','tutto',
    ]),
  },
  {
    code: 'nl',
    words: new Set([
      'de','het','een','van','en','is','dat','op','te','in','voor','met','niet','aan','zijn',
      'er','ook','als','maar','om','door','naar','worden','heeft','deze','over','bij','uit',
      'kan','wordt','nog','dan','zich','wij',
    ]),
  },
  {
    code: 'tr',
    /** Turkish is agglutinative, so its "function words" are mostly suffixes fused. */
    words: new Set([
      'bir','bu','ve','için','ile','çok','daha','ama','olarak','gibi','kadar','sonra','değil',
      'olan','şey','var','yok','böyle','şimdi','yani','ancak','hem','veya','çünkü','kendi',
      'benim','senin','bizim','şu','nasıl','neden','hiç','bütün','tüm',
    ]),
  },
]

/** Spelling that only one of a confusable pair uses. */
const MARKERS: { code: LanguageCode; re: RegExp }[] = [
  { code: 'pt', re: /ção|ções|ão\b|nh[ao]/ },
  { code: 'es', re: /ñ|¿|¡/ },
  { code: 'fr', re: /ç|œ|qu'|d'/ },
  { code: 'de', re: /ß|ä|ö|ü/ },
  // ı, ş and ğ exist in no other language written in this file.
  { code: 'tr', re: /[ışğİŞĞ]/ },
]

/** Below this there is not enough text for a stopword ratio to mean anything. */
const MIN_WORDS = 12
/** Share of words that must be function words of a language. */
const THRESHOLD = 0.06
/** Matches required before a language is named at all. */
const MIN_HITS = 2
/** How much a spelling marker is worth, as a share. */
const MARKER_BONUS = 0.03
/** Share of letters a script needs to be called the text's script. */
const SCRIPT_THRESHOLD = 0.2
/** Only the opening is examined: a long article's language is set in its first. */
const SAMPLE = 2_000

export function detectLanguage(text: string): LanguageCode {
  const sample = text.slice(0, SAMPLE)
  if (sample.trim().length === 0) return 'unknown'

  const latinCount = (sample.match(LATIN_RE) ?? []).length
  let best: { code: LanguageCode; count: number } | undefined

  for (const script of SCRIPTS) {
    const count = (sample.match(script.re) ?? []).length
    if (count === 0) continue
    /** Any kana at all settles it as Japanese. */
    if (script.code === 'ja') {
      best = { code: 'ja', count: Math.max(count, best?.count ?? 0) }
      break
    }
    if (best === undefined || count > best.count) best = { code: script.code, count }
  }

  if (best !== undefined) {
    const total = latinCount + best.count
    // A Latin article quoting one Russian word must not become Russian, so the script.
    if (total > 0 && best.count / total >= SCRIPT_THRESHOLD) {
      if (best.code === 'ru' && UKRAINIAN_LETTERS.test(sample)) return 'uk'
      return best.code
    }
  }

  if (latinCount === 0) return 'unknown'

  const words = sample.toLowerCase().match(/[a-zà-öø-ÿ']+/g) ?? []
  // Too short to judge is `unknown`, NOT a guess.
  if (words.length < MIN_WORDS) return 'unknown'

  const lowered = sample.toLowerCase()
  let winner: { code: LanguageCode; score: number } | undefined

  for (const language of STOPWORDS) {
    const hits = words.reduce((total, word) => total + (language.words.has(word) ? 1 : 0), 0)
    const marked = MARKERS.some(
      marker => marker.code === language.code && marker.re.test(lowered),
    )
    const score = marked ? hits / words.length + MARKER_BONUS : hits / words.length
    /** One function word is a coincidence unless spelling backs it up. */
    if (hits < (marked ? 1 : MIN_HITS)) continue
    if (winner === undefined || score > winner.score) winner = { code: language.code, score }
  }

  if (winner === undefined || winner.score < THRESHOLD) return 'other'
  return winner.code
}
