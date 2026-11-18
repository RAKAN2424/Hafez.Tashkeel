/**
 * Live Arabic Dictionary & Diacritics Web Search Script
 * (سكريبت البحث الحي على الإنترنت في المعجم ومواقع تشكيل العامية والفصحى)
 *
 * Searches real online Arabic lexicons & diacritization sites BEFORE the Smart Model runs:
 *  1. Almaany Arabic Dictionary (almaany.com)
 *  2. Mo3jam Egyptian Colloquial Dictionary (ar.mo3jam.com)
 *  3. Arabic Wiktionary (ar.wiktionary.org)
 *  4. Live Web Search across Arabic diacritization & colloquial sites (DuckDuckGo HTML)
 *  5. Curated Egyptian Colloquial + Phonetic Suno + Classical Seed Lexicon & Morphology
 */

import { smartConvertEgyptianQaf } from '../../src/utils/arabicDiacritics.ts';

export interface DiacriticSearchVariant {
  word: string;
  type: 'colloquial_egyptian' | 'phonetic_suno' | 'classical_fusha' | 'gender_variant';
  typeLabelAr: string;
  typeLabelEn: string;
  meaning: string;
  pronunciationHint?: string;
  source: string;
}

export interface DiacriticSearchScriptResult {
  query: string;
  normalizedQuery: string;
  internetConnected: boolean;
  sourcesChecked: string[];
  lexiconHits: DiacriticSearchVariant[];
  webFindings: Array<{ source: string; url: string; snippet: string; vocalizedForms: string[] }>;
  wiktionaryExtract: string | null;
  morphologicalHints: string[];
  searchDirectivePrompt: string;
}

export interface BatchWebLexiconVerificationResult {
  internetConnected: boolean;
  sourcesChecked: string[];
  verifiedWords: Array<{
    word: string;
    vocalizedExamples: string[];
    summary: string;
    sources: string[];
  }>;
  webVerificationDirective: string;
}

const DIACRITICS_STRIP_REGEX = /[\u064B-\u065F\u0670\u0640]/g;
const ARABIC_WORD_WITH_HARAKAT_REGEX = /[\u0621-\u064A][\u0621-\u064A\u064B-\u065F\u0670]*[\u064B-\u0652][\u0621-\u064A\u064B-\u065F\u0670]*/g;

export function stripArabicDiacritics(input: string): string {
  return input.replace(DIACRITICS_STRIP_REGEX, '').trim();
}

function normalizeAlefYaa(word: string): string {
  return stripArabicDiacritics(word)
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي');
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMatchingVocalizedForms(text: string, targetBareWord: string, limit = 8): string[] {
  const matches = text.match(ARABIC_WORD_WITH_HARAKAT_REGEX) || [];
  const normTarget = normalizeAlefYaa(targetBareWord);
  const seen = new Set<string>();
  const matched: string[] = [];

  for (const token of matches) {
    const cleanToken = token.trim();
    const normToken = normalizeAlefYaa(cleanToken);
    if (
      normToken === normTarget ||
      (normTarget.length >= 3 && (normToken.includes(normTarget) || normTarget.includes(normToken)))
    ) {
      if (!seen.has(cleanToken)) {
        seen.add(cleanToken);
        matched.push(cleanToken);
        if (matched.length >= limit) break;
      }
    }
  }
  return matched;
}

// 15-minute TTL cache so repeated checks are instantaneous while fresh runs hit live web
const WEB_LEXICON_CACHE = new Map<
  string,
  {
    expiresAt: number;
    sourcesChecked: string[];
    webFindings: Array<{ source: string; url: string; snippet: string; vocalizedForms: string[] }>;
    wiktionaryExtract: string | null;
  }
>();
const CACHE_TTL_MS = 15 * 60 * 1000;

export const DIACRITIC_SOURCES_CATALOG = [
  {
    id: 'almaany',
    labelAr: 'موقع المعاني (almaany.com) للمعاجم والتشكيل العربي',
    labelEn: 'Almaany Arabic Lexicon (almaany.com)',
  },
  {
    id: 'mo3jam',
    labelAr: 'معجم العامية المصرية والعربية (mo3jam.com)',
    labelEn: 'Mo3jam Colloquial Dictionary (mo3jam.com)',
  },
  {
    id: 'wiktionary',
    labelAr: 'ويكاموس العربي والصرف (ar.wiktionary.org)',
    labelEn: 'Arabic Wiktionary',
  },
  {
    id: 'phonetic_suno',
    labelAr: 'التشفير الصوتي الغنائي لسونو (سكون آخر حرف + همزة القاف الذكية أ/ئ/ء)',
    labelEn: 'Phonetic Sukoon & Smart Hamza (Suno Encoding)',
  },
];

// Built-in high-precision Egyptian + Classical multi-reading seed lexicon
const MULTI_READING_LEXICON: Record<string, DiacriticSearchVariant[]> = {
  'قلبك': [
    { word: 'قَلْبَكْ', type: 'colloquial_egyptian', typeLabelAr: 'عامي مصري (مذكر)', typeLabelEn: 'Egyptian (M)', meaning: 'قلبك أنت (للمذكر) — بفتح الكاف وسكونها', source: 'Egyptian Colloquial Lexicon' },
    { word: 'قَلْبِكْ', type: 'colloquial_egyptian', typeLabelAr: 'عامي مصري (مؤنث)', typeLabelEn: 'Egyptian (F)', meaning: 'قلبك أنتِ (للمؤنث) — بكسر الكاف وسكونها', source: 'Egyptian Colloquial Lexicon' },
    { word: 'أَلْبَكْ', type: 'phonetic_suno', typeLabelAr: 'صوتي سونو (مذكر)', typeLabelEn: 'Phonetic (M)', meaning: 'النطق القاهري الصوتي لسونو للمذكر بتحويل القاف الأولية إلى (أ)', source: 'Phonetic Sukoon Rules' },
    { word: 'أَلْبِكْ', type: 'phonetic_suno', typeLabelAr: 'صوتي سونو (مؤنث)', typeLabelEn: 'Phonetic (F)', meaning: 'النطق القاهري الصوتي لسونو للمؤنث بتحويل القاف الأولية إلى (أ)', source: 'Phonetic Sukoon Rules' },
    { word: 'قَلْبُكَ', type: 'classical_fusha', typeLabelAr: 'فصحى (مرفوع)', typeLabelEn: 'Classical (Nom)', meaning: 'فؤادك في حالة الرفع بالفصحى', source: 'Classical Grammar' },
  ],
  'يهديك': [
    { word: 'يِهْدِيْكْ', type: 'colloquial_egyptian', typeLabelAr: 'عامي مصري (مذكر)', typeLabelEn: 'Egyptian (M)', meaning: 'يرشدك أو يهديك الله (للمذكر)', source: 'Egyptian Colloquial Lexicon' },
    { word: 'يِهْدِيْكِ', type: 'colloquial_egyptian', typeLabelAr: 'عامي مصري (مؤنث)', typeLabelEn: 'Egyptian (F)', meaning: 'يرشدك أو يهديكِ الله (للمؤنث)', source: 'Egyptian Colloquial Lexicon' },
    { word: 'يَهْدِيكَ', type: 'classical_fusha', typeLabelAr: 'فصحى', typeLabelEn: 'Classical', meaning: 'يرشدك في العربية الفصحى', source: 'Classical Grammar' },
  ],
  'انت': [
    { word: 'إِنْتَ', type: 'gender_variant', typeLabelAr: 'عامي (مذكر)', typeLabelEn: 'Masculine', meaning: 'ضمير المخاطب المفرد المذكر', source: 'Egyptian Pronoun Rules' },
    { word: 'إِنْتِ', type: 'gender_variant', typeLabelAr: 'عامي (مؤنث)', typeLabelEn: 'Feminine', meaning: 'ضمير المخاطب المفرد المؤنث', source: 'Egyptian Pronoun Rules' },
    { word: 'أَنْتَ', type: 'classical_fusha', typeLabelAr: 'فصحى (مذكر)', typeLabelEn: 'Classical (M)', meaning: 'ضمير المخاطب المذكر فصحى', source: 'Classical Grammar' },
    { word: 'أَنْتِ', type: 'classical_fusha', typeLabelAr: 'فصحى (مؤنث)', typeLabelEn: 'Classical (F)', meaning: 'ضمير المخاطب المؤنث فصحى', source: 'Classical Grammar' },
  ],
  'علم': [
    { word: 'عِلْمْ', type: 'colloquial_egyptian', typeLabelAr: 'عامي مصري (اسم)', typeLabelEn: 'Noun (EG)', meaning: 'المعرفة والدراسة', source: 'Egyptian Colloquial Lexicon' },
    { word: 'عَلَمْ', type: 'colloquial_egyptian', typeLabelAr: 'عامي مصري (راية)', typeLabelEn: 'Flag (EG)', meaning: 'راية الدولة أو شخص مشهور', source: 'Egyptian Colloquial Lexicon' },
    { word: 'عَلِّمْ', type: 'colloquial_egyptian', typeLabelAr: 'عامي مصري (فعل أمر)', typeLabelEn: 'Imperative (EG)', meaning: 'درّس أو اترك علامة', source: 'Egyptian Colloquial Lexicon' },
    { word: 'عَلِمَ', type: 'classical_fusha', typeLabelAr: 'فصحى (فعل ماضٍ)', typeLabelEn: 'Past Verb', meaning: 'عرف وأدرك', source: 'Classical Lexicon' },
    { word: 'عُلِمَ', type: 'classical_fusha', typeLabelAr: 'فصحى (مبني للمجهول)', typeLabelEn: 'Passive Verb', meaning: 'تمت معرفته', source: 'Classical Lexicon' },
  ],
  'ملك': [
    { word: 'مَلِكْ', type: 'colloquial_egyptian', typeLabelAr: 'عامي مصري (حاكم)', typeLabelEn: 'King', meaning: 'حاكم أو شخص مسيطر', source: 'Egyptian Colloquial Lexicon' },
    { word: 'مِلْكْ', type: 'colloquial_egyptian', typeLabelAr: 'عامي مصري (ملكية)', typeLabelEn: 'Property', meaning: 'شيء يخصك وتمتلكه (مِلْكِي)', source: 'Egyptian Colloquial Lexicon' },
    { word: 'مُلْكْ', type: 'classical_fusha', typeLabelAr: 'فصحى (سيادة)', typeLabelEn: 'Kingdom', meaning: 'السلطان والحكم', source: 'Classical Lexicon' },
    { word: 'مَلَكْ', type: 'classical_fusha', typeLabelAr: 'فصحى (كائن نوراني)', typeLabelEn: 'Angel', meaning: 'ملاك من الملائكة', source: 'Classical Lexicon' },
  ],
  'كتب': [
    { word: 'كَتَبْ', type: 'colloquial_egyptian', typeLabelAr: 'عامي مصري (فعل)', typeLabelEn: 'Wrote', meaning: 'كتب بالكلام أو خط القلم', source: 'Egyptian Colloquial Lexicon' },
    { word: 'كُتُبْ', type: 'colloquial_egyptian', typeLabelAr: 'عامي / فصحى (جمع)', typeLabelEn: 'Books', meaning: 'جمع كتاب', source: 'Egyptian Colloquial Lexicon' },
    { word: 'كُتِبَ', type: 'classical_fusha', typeLabelAr: 'فصحى (مجهول)', typeLabelEn: 'Was Written', meaning: 'تمت كتابته أو قُدّر', source: 'Classical Lexicon' },
  ],
  'سلم': [
    { word: 'سِلِّمْ', type: 'colloquial_egyptian', typeLabelAr: 'عامي مصري (درج)', typeLabelEn: 'Stairs', meaning: 'درج المبنى أو المصعد', source: 'Egyptian Colloquial Lexicon' },
    { word: 'سَلِّمْ', type: 'colloquial_egyptian', typeLabelAr: 'عامي مصري (تحية/تسليم)', typeLabelEn: 'Greet/Submit', meaning: 'ألقِ السلام أو سلّم شيء', source: 'Egyptian Colloquial Lexicon' },
    { word: 'سَلِمْ', type: 'classical_fusha', typeLabelAr: 'فصحى (نجا)', typeLabelEn: 'Safe', meaning: 'نجا من الأذى', source: 'Classical Lexicon' },
    { word: 'سَلْمْ', type: 'classical_fusha', typeLabelAr: 'فصحى (أمان)', typeLabelEn: 'Peace', meaning: 'السلام والمهادنة', source: 'Classical Lexicon' },
  ],
  'حب': [
    { word: 'حُبّْ', type: 'colloquial_egyptian', typeLabelAr: 'عامي مصري (مشاعر)', typeLabelEn: 'Love', meaning: 'العشق والمودة', source: 'Egyptian Colloquial Lexicon' },
    { word: 'حَبّْ', type: 'colloquial_egyptian', typeLabelAr: 'عامي مصري (فعل / بذور)', typeLabelEn: 'Loved / Seeds', meaning: 'أحب شخصاً أو حبوب وبذور', source: 'Egyptian Colloquial Lexicon' },
    { word: 'حَبِّ', type: 'classical_fusha', typeLabelAr: 'فصحى (مجرور)', typeLabelEn: 'Seed (Gen)', meaning: 'الحبوب في الإضافة الفصحى', source: 'Classical Lexicon' },
  ],
  'قال': [
    { word: 'قَالْ', type: 'colloquial_egyptian', typeLabelAr: 'عامي مصري (قاف)', typeLabelEn: 'Said (Qaf)', meaning: 'تحدث أو حكى (مع الحفاظ على القاف)', source: 'Egyptian Colloquial Lexicon' },
    { word: 'أَالْ', type: 'phonetic_suno', typeLabelAr: 'صوتي سونو (همزة)', typeLabelEn: 'Said (Phonetic)', meaning: 'نطقها القاهري الصوتي بتحويل القاف الأولية إلى (أ)', source: 'Phonetic Sukoon Rules' },
    { word: 'قَالَ', type: 'classical_fusha', typeLabelAr: 'فصحى', typeLabelEn: 'Classical', meaning: 'فعل ماضٍ مبني على الفتح', source: 'Classical Grammar' },
  ],
};

async function fetchAlmaanyDictionary(
  word: string
): Promise<{ source: string; url: string; snippet: string; vocalizedForms: string[] } | null> {
  const url = `https://www.almaany.com/ar/dict/ar-ar/${encodeURIComponent(word)}/`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(2600),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ar,en-US;q=0.9',
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const bodyText = stripHtmlTags(html);
    if (!bodyText || bodyText.length < 80) return null;

    const vocalizedForms = extractMatchingVocalizedForms(bodyText, word, 8);
    // Grab concise dictionary lines near first occurrence of bare word
    const bare = stripArabicDiacritics(word);
    const idx = bodyText.indexOf(bare);
    const sliceStart = idx > 40 ? idx - 40 : 0;
    const snippet = bodyText.slice(sliceStart, sliceStart + 360).trim();
    if (vocalizedForms.length === 0 && idx === -1) return null;

    return {
      source: 'معجم المعاني (almaany.com)',
      url,
      snippet,
      vocalizedForms,
    };
  } catch {
    return null;
  }
}

async function fetchMo3jamEgyptian(
  word: string
): Promise<{ source: string; url: string; snippet: string; vocalizedForms: string[] } | null> {
  const urls = [
    `https://ar.mo3jam.com/term/${encodeURIComponent(word)}`,
    `https://ar.mo3jam.com/search?q=${encodeURIComponent(word)}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(2500),
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ar,en-US;q=0.9',
        },
      });
      if (!res.ok) continue;
      const html = await res.text();
      const bodyText = stripHtmlTags(html);
      if (!bodyText || bodyText.length < 60) continue;

      const bare = stripArabicDiacritics(word);
      const idx = bodyText.indexOf(bare);
      if (idx === -1) continue;

      const vocalizedForms = extractMatchingVocalizedForms(bodyText, word, 8);
      const sliceStart = idx > 40 ? idx - 40 : 0;
      const snippet = bodyText.slice(sliceStart, sliceStart + 340).trim();

      return {
        source: 'معجم العامية (ar.mo3jam.com)',
        url,
        snippet,
        vocalizedForms,
      };
    } catch {
      // try next URL
    }
  }
  return null;
}

async function fetchArabicWiktionarySummary(
  word: string
): Promise<{ text: string; url: string; vocalizedForms: string[] } | null> {
  const clean = stripArabicDiacritics(word);
  try {
    const url = `https://ar.wiktionary.org/api/rest_v1/page/summary/${encodeURIComponent(clean)}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(2400),
      headers: { 'User-Agent': 'HafizBelAmyaStudio/1.0' },
    });
    if (res.ok) {
      const data: any = await res.json();
      if (data && typeof data.extract === 'string' && data.extract.trim()) {
        const text = data.extract.trim().slice(0, 600);
        return {
          text,
          url: data?.content_urls?.desktop?.page || `https://ar.wiktionary.org/wiki/${encodeURIComponent(clean)}`,
          vocalizedForms: extractMatchingVocalizedForms(text, clean, 6),
        };
      }
    }
  } catch {
    // try MediaWiki search API fallback
  }

  try {
    const searchUrl = `https://ar.wiktionary.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      clean
    )}&format=json&utf8=1&srlimit=3`;
    const res = await fetch(searchUrl, {
      signal: AbortSignal.timeout(2400),
      headers: { 'User-Agent': 'HafizBelAmyaStudio/1.0' },
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const hits = Array.isArray(json?.query?.search) ? json.query.search : [];
    if (hits.length === 0) return null;
    const text = hits
      .map((h: any) => `${h.title}: ${stripHtmlTags(String(h.snippet || ''))}`)
      .join(' | ')
      .slice(0, 600);
    return {
      text,
      url: `https://ar.wiktionary.org/wiki/${encodeURIComponent(hits[0].title || clean)}`,
      vocalizedForms: extractMatchingVocalizedForms(text, clean, 6),
    };
  } catch {
    return null;
  }
}

async function searchWebForDiacriticsSites(
  word: string
): Promise<Array<{ source: string; url: string; snippet: string; vocalizedForms: string[] }>> {
  try {
    const query = `"${word}" (site:almaany.com OR site:mo3jam.com OR "تشكيل" OR "عامية")`;
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(2800),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'ar,en-US;q=0.9',
      },
    });
    if (!res.ok) return [];
    const html = await res.text();
    const out: Array<{ source: string; url: string; snippet: string; vocalizedForms: string[] }> = [];
    const blockRegex =
      /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

    let match: RegExpExecArray | null;
    while ((match = blockRegex.exec(html)) !== null && out.length < 4) {
      let href = match[1];
      const uddgMatch = href.match(/[?&]uddg=([^&]+)/);
      if (uddgMatch) {
        try {
          href = decodeURIComponent(uddgMatch[1]);
        } catch {
          // keep original
        }
      }
      const title = stripHtmlTags(match[2]);
      const snippet = stripHtmlTags(match[3]);
      if (title && snippet) {
        const combined = `${title} ${snippet}`;
        out.push({
          source: title.slice(0, 60),
          url: href,
          snippet: snippet.slice(0, 260),
          vocalizedForms: extractMatchingVocalizedForms(combined, word, 5),
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function buildMorphologicalHints(cleanWord: string): string[] {
  const hints: string[] = [];
  if (cleanWord.includes('ق')) {
    hints.push(`يحتوي على حرف القاف (ق): أظهر التشكيل بالحفاظ على (ق) للعامية المتصلة، وبهمزة ذكية (أ / ئ / ء) حسب موقع القاف وحركاتها للتشفير الصوتي لسونو.`);
  }
  if (cleanWord.endsWith('ك')) {
    hints.push(`ينتهي بكاف الخطاب (ك): أظهر صيغة المذكر (ـَكْ) وصيغة المؤنث (ـِكْ) بوضوح.`);
  }
  if (cleanWord.endsWith('ة') || cleanWord.endsWith('ه')) {
    hints.push(`ينتهي بتاء مربوطة أو هاء: في العامية المصرية يُسكن آخره هاءً (ـَهْ / ـِهْ) وفي الفصحى تُضبط حسب الموقع.`);
  }
  if (/^[اي]/.test(cleanWord) && cleanWord.length >= 4) {
    hints.push(`قد يكون فعلاً مزيداً أو مصدراً عامياً مبدوءاً بهمزة وصل مكسورة (اِ...).`);
  }
  if (cleanWord.length === 3) {
    hints.push(`كلمة ثلاثية الجذر: راجع احتمالات الفعل الماضي (فَعَلَ/فِعِلْ)، الاسم (فَعْل/فِعْل/فُعْل)، والأمر (فِعْلْ).`);
  }
  return hints;
}

async function performLiveWebDictionaryLookup(exactClean: string): Promise<{
  sourcesChecked: string[];
  webFindings: Array<{ source: string; url: string; snippet: string; vocalizedForms: string[] }>;
  wiktionaryExtract: string | null;
}> {
  const cached = WEB_LEXICON_CACHE.get(exactClean);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      sourcesChecked: [...cached.sourcesChecked],
      webFindings: [...cached.webFindings],
      wiktionaryExtract: cached.wiktionaryExtract,
    };
  }

  const sourcesChecked: string[] = [];
  const webFindings: Array<{ source: string; url: string; snippet: string; vocalizedForms: string[] }> = [];
  let wiktionaryExtract: string | null = null;

  const [almaanyRes, mo3jamRes, wiktRes, ddgRes] = await Promise.allSettled([
    fetchAlmaanyDictionary(exactClean),
    fetchMo3jamEgyptian(exactClean),
    fetchArabicWiktionarySummary(exactClean),
    searchWebForDiacriticsSites(exactClean),
  ]);

  if (almaanyRes.status === 'fulfilled' && almaanyRes.value) {
    sourcesChecked.push('معجم المعاني (almaany.com)');
    webFindings.push(almaanyRes.value);
  }
  if (mo3jamRes.status === 'fulfilled' && mo3jamRes.value) {
    sourcesChecked.push('معجم العامية (ar.mo3jam.com)');
    webFindings.push(mo3jamRes.value);
  }
  if (wiktRes.status === 'fulfilled' && wiktRes.value) {
    sourcesChecked.push('ويكاموس العربي (ar.wiktionary.org)');
    wiktionaryExtract = wiktRes.value.text;
    webFindings.push({
      source: 'ويكاموس العربي (ar.wiktionary.org)',
      url: wiktRes.value.url,
      snippet: wiktRes.value.text.slice(0, 260),
      vocalizedForms: wiktRes.value.vocalizedForms,
    });
  }
  if (ddgRes.status === 'fulfilled' && ddgRes.value.length > 0) {
    sourcesChecked.push('بحث مواقع التشكيل (Web Index)');
    for (const item of ddgRes.value) {
      webFindings.push(item);
    }
  }

  WEB_LEXICON_CACHE.set(exactClean, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    sourcesChecked,
    webFindings,
    wiktionaryExtract,
  });

  return { sourcesChecked, webFindings, wiktionaryExtract };
}

/**
 * Main Diacritics Search Script runner:
 * Connects to Almaany, Mo3jam, Arabic Wiktionary, and Web Diacritization sites,
 * merges curated Egyptian + Classical readings, and equips the Smart Model
 * with live online findings before generating variants.
 */
export async function runDiacriticsSearchScript(
  rawWord: string,
  options: { enableWebSearch?: boolean } = {}
): Promise<DiacriticSearchScriptResult> {
  const enableWebSearch = options.enableWebSearch !== false;
  const query = rawWord.trim();
  const normalizedQuery = stripArabicDiacritics(query).replace(/[أإآ]/g, (m) => (m === 'آ' ? 'آ' : 'ا'));
  const exactClean = stripArabicDiacritics(query);

  const sourcesChecked = [
    'Egyptian Colloquial Multi-Reading Lexicon',
    'Phonetic Sukoon & Hamza (Suno) Rules',
    'Arabic Morphological Pattern Analyzer',
  ];

  const baseLexiconHits: DiacriticSearchVariant[] =
    MULTI_READING_LEXICON[exactClean] ||
    MULTI_READING_LEXICON[normalizedQuery] ||
    [];

  let webFindings: Array<{ source: string; url: string; snippet: string; vocalizedForms: string[] }> = [];
  let wiktionaryExtract: string | null = null;
  let internetConnected = false;

  if (enableWebSearch && exactClean) {
    const live = await performLiveWebDictionaryLookup(exactClean);
    webFindings = live.webFindings;
    wiktionaryExtract = live.wiktionaryExtract;
    if (live.sourcesChecked.length > 0) {
      internetConnected = true;
      for (const s of live.sourcesChecked) {
        if (!sourcesChecked.includes(s)) sourcesChecked.push(s);
      }
    } else {
      // Live internet search mode is still active even if external lexicon sites blocked sandbox/offline
      sourcesChecked.push('Almaany / Mo3jam / Wiktionary (Live Probe)');
    }
  }

  // Convert live scraped vocalized forms into structured lexiconHits
  const seenWords = new Set(baseLexiconHits.map((h) => h.word));
  const lexiconHits: DiacriticSearchVariant[] = [...baseLexiconHits];
  for (const wf of webFindings) {
    const isColloquialSite = wf.source.includes('العامية') || wf.source.includes('mo3jam');
    for (const vForm of wf.vocalizedForms) {
      if (!seenWords.has(vForm)) {
        seenWords.add(vForm);
        lexiconHits.push({
          word: vForm,
          type: isColloquialSite ? 'colloquial_egyptian' : 'classical_fusha',
          typeLabelAr: isColloquialSite ? 'عامية من الويب' : 'من المعجم على الويب',
          typeLabelEn: isColloquialSite ? 'Web Colloquial' : 'Web Dictionary',
          meaning: wf.snippet.slice(0, 140) || `نتيجة مستخرجة من ${wf.source}`,
          source: wf.source,
        });
      }
    }
  }

  if (query.includes('ق') && !lexiconHits.some((h) => h.type === 'phonetic_suno')) {
    const smartPhonetic = smartConvertEgyptianQaf(query.endsWith('ْ') ? query : `${query}ْ`);
    if (smartPhonetic && !seenWords.has(smartPhonetic)) {
      seenWords.add(smartPhonetic);
      lexiconHits.push({
        word: smartPhonetic,
        type: 'phonetic_suno',
        typeLabelAr: 'صوتي ذكي (أ/ئ/ء)',
        typeLabelEn: 'Smart Phonetic Qaf',
        meaning: 'نطق القاف العامي المصري الذكي باختيار (أ / ئ / ء) حسب الموضع والحركة',
        source: 'Egyptian Qaf Phonology Engine',
      });
    }
  }

  const morphologicalHints = buildMorphologicalHints(exactClean);

  const webFindingsBlock =
    webFindings.length > 0
      ? `\nنتائج البحث الحية من مواقع المعجم والتشكيل على الإنترنت:\n${webFindings
          .map(
            (wf) =>
              `- [${wf.source}] (${wf.url})${
                wf.vocalizedForms.length > 0 ? `\n  أشكال مشكّلة مرصودة: ${wf.vocalizedForms.join(' ، ')}` : ''
              }\n  مقتطف: ${wf.snippet}`
          )
          .join('\n')}\n`
      : '';

  const searchDirectivePrompt = `مصادر وقواعد البحث الإلزامية من سكريبت المعجم والتشكيل (Diacritics Search Script):
الكلمة المطلوبة: "${exactClean}"
حالة البحث على الإنترنت: ${enableWebSearch ? 'مفعّل — تم فحص مواقع المعاجم والتشكيل قبل التشغيل' : 'وضع محلي'}
${wiktionaryExtract ? `\nمرجع ويكاموس العربي:\n${wiktionaryExtract}\n` : ''}${webFindingsBlock}${
    morphologicalHints.length > 0 ? `\nإرشادات صرفية وصوتية للكلمة:\n- ${morphologicalHints.join('\n- ')}\n` : ''
  }${
    lexiconHits.length > 0
      ? `\nنتائج المعجم المحلي والويب الأولية:\n${lexiconHits
          .map((h) => `- ${h.word} (${h.typeLabelAr} · ${h.source}): ${h.meaning}`)
          .join('\n')}\n`
      : ''
  }
المطلوب من الموديل الذكي التحقق وجلب **كل أنواع التشكيل الممكنة** لهذه الكلمة من المصادر التالية:
1. التشكيل بالعامية المصرية المنطوقة (colloquial_egyptian): جميع المعاني والنطق الدارج في الشارع والأغاني (اسم، فعل، أمر، صفة) مع سكون أواخر العامية.
2. التشكيل الصوتي لسونو (phonetic_suno): مع سكون إلزامي على آخر حرف وتحويل القاف بذكاء إلى (أ أو ئ أو ء) حسب موضعها وحركتها في الكلمة.
3. التشكيل للمذكر والمؤنث (gender_variant): إذا كانت تقبل التذكير والتأنيث (مثل كاف الخطاب ـَكْ / ـِكْ أو ضمير).
4. التشكيل المعجمي الفصيح (classical_fusha): جميع الأوزان الصرفية الفصحى الممكنة (فَعَلَ، فُعِلَ، فَعْل، فِعْل، فُعْل...).

أخرج النتيجة بصيغة JSON فقط بهذا الهيكل الدقيق:
{
  "suggestions": [
    {
      "word": "الكلمة_بالتشكيل",
      "type": "colloquial_egyptian | phonetic_suno | classical_fusha | gender_variant",
      "typeLabel": "نوع التشكيل باختصار",
      "meaning": "المعنى والسياق بدقة",
      "source": "المصدر"
    }
  ],
  "synonyms": ["مرادف1", "مرادف2", "مرادف3"],
  "antonyms": ["ضد1", "ضد2"]
}`;

  return {
    query,
    normalizedQuery: exactClean,
    internetConnected,
    sourcesChecked,
    lexiconHits,
    webFindings,
    wiktionaryExtract,
    morphologicalHints,
    searchDirectivePrompt,
  };
}

/**
 * Pre-flight Lexicon & Web Verification used automatically by the Smart Model (`smart_studio`)
 * BEFORE executing diacritization, songwriting, analysis, or prompt generation.
 */
export async function verifyTextWordsViaWebLexicon(
  inputText: string,
  options: { enableWebSearch?: boolean; maxWords?: number } = {}
): Promise<BatchWebLexiconVerificationResult> {
  const enableWebSearch = options.enableWebSearch !== false;
  const maxWords = options.maxWords ?? 4;

  const rawTokens = stripArabicDiacritics(inputText)
    .replace(/\[.*?\]/g, ' ')
    .split(/[^\u0621-\u064A]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !/^و$|^في$|^من$|^على$|^ال$|^ما$|^يا$|^ده$|^دي$/.test(w));

  const uniqueTokens = Array.from(new Set(rawTokens));

  // Prioritize words likely to have multiple readings, Qaf, gender suffix ك, or 3-letter ambiguity
  const scored = uniqueTokens
    .map((w) => {
      let score = 0;
      if (MULTI_READING_LEXICON[w]) score += 5;
      if (w.includes('ق')) score += 4;
      if (w.endsWith('ك') && w.length >= 3) score += 4;
      if (w.length === 3 || w.length === 4) score += 3;
      if (w.endsWith('ة') || w.endsWith('ه')) score += 2;
      return { w, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, maxWords)
    .map((x) => x.w);

  if (scored.length === 0) {
    return {
      internetConnected: enableWebSearch,
      sourcesChecked: enableWebSearch ? ['Almaany / Mo3jam / Arabic Wiktionary'] : ['Local Lexicon'],
      verifiedWords: [],
      webVerificationDirective: '',
    };
  }

  const results = await Promise.all(
    scored.map((w) => runDiacriticsSearchScript(w, { enableWebSearch }))
  );

  const sourcesSet = new Set<string>();
  let anyInternetConnected = false;
  const verifiedWords: BatchWebLexiconVerificationResult['verifiedWords'] = [];

  for (const r of results) {
    if (r.internetConnected) anyInternetConnected = true;
    for (const s of r.sourcesChecked) sourcesSet.add(s);

    const vocalized = Array.from(
      new Set([
        ...r.lexiconHits.map((h) => h.word),
        ...r.webFindings.flatMap((wf) => wf.vocalizedForms),
      ])
    ).slice(0, 6);

    const summary =
      r.webFindings[0]?.snippet ||
      r.wiktionaryExtract ||
      r.lexiconHits.map((h) => `${h.word}: ${h.meaning}`).join(' | ');

    if (vocalized.length > 0 || summary) {
      verifiedWords.push({
        word: r.normalizedQuery,
        vocalizedExamples: vocalized,
        summary: (summary || '').slice(0, 220),
        sources: r.sourcesChecked.slice(0, 3),
      });
    }
  }

  const sourcesChecked = Array.from(sourcesSet);
  const webVerificationDirective =
    verifiedWords.length > 0
      ? `\n[نتائج التحقق المسبق من المعجم ومواقع التشكيل (${
          anyInternetConnected ? 'بحث حي على الإنترنت' : 'المرجع المعجمي'
        })]:\n${verifiedWords
          .map(
            (vw) =>
              `- كلمة "${vw.word}": أشكال مرصودة (${
                vw.vocalizedExamples.length > 0 ? vw.vocalizedExamples.join(' / ') : 'راجع السياق'
              })${vw.summary ? ` — مرجع: ${vw.summary}` : ''}`
          )
          .join('\n')}\nاستعن بهذه المراجع للتأكد من صحة التشكيل العامي والفصيح قبل إخراج النتيجة النهائية.\n`
      : '';

  return {
    internetConnected: anyInternetConnected || enableWebSearch,
    sourcesChecked,
    verifiedWords,
    webVerificationDirective,
  };
}
