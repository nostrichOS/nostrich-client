import { describe, expect, it } from 'vitest'

import { LANGUAGE_LABELS, detectLanguage, matchesLanguage, type LanguageCode } from './language'

/** What the News language filter is allowed to get wrong. */

/** Ordinary prose, one paragraph, the length a long-form post's opening actually. */
const LATIN: { code: LanguageCode; text: string }[] = [
  {
    code: 'en',
    text: 'The problem with the feed is that it can be more or less the same for everyone, and there is not one thing we can do about it from here when all of this has been decided.',
  },
  {
    code: 'es',
    text: 'El problema de las noticias es que los lectores no pueden ver más que una parte, pero sin duda hay algo para todos cuando se busca con calma sobre este asunto.',
  },
  {
    code: 'pt',
    text: 'A questão é que uma parte dos leitores não consegue ver mais do que isso, mas você pode fazer alguma coisa sobre a situação quando ela está muito ruim.',
  },
  {
    code: 'fr',
    text: "Le problème des nouvelles est que les lecteurs ne peuvent pas voir plus qu'une partie, mais il y a tout de même quelque chose pour tout le monde dans ce fait.",
  },
  {
    code: 'de',
    text: 'Das Problem mit den Nachrichten ist, dass die Leser nicht mehr als einen Teil sehen können, und es gibt auch nichts, was man von hier aus dagegen tun kann.',
  },
  {
    code: 'it',
    text: "Il problema delle notizie è che i lettori non possono vedere più di una parte, ma non c'è niente che si possa fare da qui quando tutto è così.",
  },
  {
    code: 'nl',
    text: 'Het probleem met het nieuws is dat de lezers niet meer dan een deel kunnen zien, en er is ook niets wat we hier aan kunnen doen met deze.',
  },
]

const SCRIPT: { code: LanguageCode; text: string }[] = [
  { code: 'ru', text: 'Проблема в том, что читатели видят только часть новостей, и с этим ничего нельзя сделать отсюда.' },
  { code: 'el', text: 'Αυτό είναι ένα μεγάλο πρόβλημα και δεν μπορεί να λυθεί από εδώ.' },
  { code: 'ar', text: 'هذه مشكلة كبيرة ولا يمكن حلها من هنا في الوقت الحالي.' },
  { code: 'he', text: 'זו בעיה גדולה ואי אפשר לפתור אותה מכאן בזמן הזה.' },
  { code: 'hi', text: 'यह एक बड़ी समस्या है और इसे यहाँ से हल नहीं किया जा सकता।' },
  { code: 'th', text: 'นี่เป็นปัญหาใหญ่และไม่สามารถแก้ไขได้จากที่นี่ในตอนนี้' },
  { code: 'ko', text: '오늘 날씨가 아주 좋아서 우리는 공원에 산책하러 갔습니다.' },
  { code: 'zh', text: '今天天气很好，我们一起去公园散步吧，然后回家吃饭。' },
  // Japanese prose is kana and han together, so han alone must not be what claims.
  { code: 'ja', text: 'きのう東京で新しい本を買いました。とても面白かったので、みなさんにもおすすめしたいと思います。' },
]

describe('script', () => {
  for (const { code, text } of SCRIPT) {
    it(`reads ${LANGUAGE_LABELS[code]}`, () => {
      expect(detectLanguage(text)).toBe(code)
    })
  }

  /** One quoted foreign word is not a change of language. */
  it('does not hand an English article to Russian over one quoted word', () => {
    const text =
      'The article quotes the Russian word Привет once and is otherwise ordinary English prose written here.'
    expect(detectLanguage(text)).toBe('en')
  })
})

describe('the Cyrillic split', () => {
  const RUSSIAN = 'Проблема в том, что читатели видят только часть новостей, и с этим ничего нельзя сделать отсюда.'

  it('reads Ukrainian', () => {
    expect(
      detectLanguage('Проблема в тому, що читачі бачать лише частину новин, і з цим нічого не можна зробити звідси.'),
    ).toBe('uk')
  })

  /** і, ї, є and ґ are not in the Russian alphabet at all, so one of them settles. */
  it('lets a single Ukrainian-only letter decide', () => {
    expect(detectLanguage(RUSSIAN)).toBe('ru')
    expect(detectLanguage(`${RUSSIAN} Кіно`)).toBe('uk')
  })
})

describe('the Latin languages', () => {
  for (const { code, text } of LATIN) {
    it(`reads ${LANGUAGE_LABELS[code]}`, () => {
      expect(detectLanguage(text)).toBe(code)
    })
  }

  /** The shape of the bug that emptied the Spanish and Portuguese filters. */
  it('scores Spanish function words that carry accents', () => {
    expect(
      detectLanguage(
        'Aquí está la vida: siempre más lenta, siempre así, y también un poco rara; nadie sabe qué vendrá luego ni cuánto durará.',
      ),
    ).toBe('es')
  })

  it('scores Portuguese function words that carry accents', () => {
    expect(
      detectLanguage(
        'Aqui está a vida: sempre devagar, sempre assim, e também um pouco esquisita; ninguém sabe até onde já vamos parar hoje.',
      ),
    ).toBe('pt')
  })

  /** A language we cannot name is named Other, never the nearest plausible-looking guess. */
  it('refuses to invent a language for Latin text it does not know', () => {
    expect(
      detectLanguage('Habari za asubuhi rafiki yangu, tunakwenda sokoni leo kununua matunda na mboga kwa chakula cha jioni.'),
    ).toBe('other')
  })

  /** Only the opening is read, and it has to stay that way: the detector runs. */
  it('decides on the opening rather than the bulk of a long article', () => {
    const spanish =
      'El problema de las noticias es que los lectores no pueden ver más que una parte, pero sin duda hay algo para todos cuando se busca con calma sobre este asunto. '
    const english =
      'The problem with the feed is that it can be more or less the same for everyone, and there is not one thing we can do about it from here when all of this has been decided. '
    expect(detectLanguage(spanish.repeat(13).slice(0, 2000) + english.repeat(20))).toBe('es')
  })
})

/** Spelling as the tie-breaker. */
describe('the orthographic markers', () => {
  const AMBIGUOUS = 'para ser como está, porque desde entre sobre por que, '.repeat(4)
  /** One Portuguese-only word ahead. */
  const LEANS_PORTUGUESE = `${AMBIGUOUS} mais`

  it('lets ção pull an even Iberian text to Portuguese', () => {
    expect(detectLanguage(AMBIGUOUS)).not.toBe('pt')
    expect(detectLanguage(`${AMBIGUOUS} informação`)).toBe('pt')
  })

  it('lets ñ pull a Portuguese-leaning text to Spanish', () => {
    expect(detectLanguage(LEANS_PORTUGUESE)).toBe('pt')
    expect(detectLanguage(`${LEANS_PORTUGUESE} España`)).toBe('es')
  })

  it('lets ß carry a German fragment that its function words do not', () => {
    // Swiss spelling writes ss for ß, which is the same sentence without the marker.
    const swiss = 'Politik und Wirtschaft in Berlin: kalte Nacht, langer Weg, viele Leute, weisse Wand, leise Musik'
    expect(detectLanguage(swiss)).not.toBe('de')
    expect(detectLanguage(swiss.replace('weisse', 'weiße'))).toBe('de')
  })

  /** A marker is worth less than the threshold on purpose. */
  it('does not let a marker alone name a language', () => {
    expect(
      detectLanguage(
        'Vi gick en lång promenad i parken när solen gick ner, och sedan drack vi kaffe hemma hos min bror i köket.',
      ),
    ).toBe('other')
  })

  it('names Turkish from its own function words, not from its diacritics', () => {
    // ı, ş and ğ are the tiebreaker.
    expect(
      detectLanguage(
        'Bugün hava çok güzel olduğu için parkta uzun bir yürüyüş yaptık, sonra eve dönüp çay içtik ve biraz kitap okuduk.',
      ),
    ).toBe('tr')
  })
})

describe('too little to judge', () => {
  /** Every one of these is a note that exists and has no language. */
  for (const [name, text] of [
    ['nothing at all', ''],
    ['whitespace', '   \n\t  '],
    ['emoji only', '🎉🔥😀 🚀 ⚡️'],
    ['digits only', '1234 5678 90 42'],
  ] as const) {
    it(`answers unknown for ${name}`, () => {
      expect(detectLanguage(text)).toBe('unknown')
    })
  }

  /** A stopword ratio over a handful of words is a coin flip, and a coin flip that lands. */
  it('will not guess from eleven words but will from twelve', () => {
    const eleven = 'There is more to this than one would have been about'
    expect(detectLanguage(eleven)).toBe('unknown')
    expect(detectLanguage(`${eleven} it`)).toBe('en')
  })
})

describe('the filter', () => {
  const CODES = Object.keys(LANGUAGE_LABELS) as LanguageCode[]

  it('keeps everything under All', () => {
    for (const code of CODES) expect(matchesLanguage(code, 'all')).toBe(true)
  })

  /** The rule the rest of this file exists to protect. */
  it('never hides an undetectable note', () => {
    for (const selected of CODES) expect(matchesLanguage('unknown', selected)).toBe(true)
  })

  it('hides a note that was read as a different language', () => {
    expect(matchesLanguage('es', 'es')).toBe(true)
    expect(matchesLanguage('pt', 'es')).toBe(false)
  })

  /** Other is a verdict, not a shrug: the detector read enough. */
  it('hides Other, which is why undetectable text must not be Other', () => {
    expect(matchesLanguage('other', 'es')).toBe(false)
    expect(matchesLanguage('other', 'other')).toBe(true)
  })
})
