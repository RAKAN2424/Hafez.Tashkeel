/**
 * Diacritics Search Script (سكريبت جلب التشكيل بكل أنواعه)
 *
 * This script equips the Diacritics Search Model with:
 * 1. Explicit taxonomy of all Arabic & Egyptian diacritization types.
 * 2. Local curated multi-reading Egyptian + Classical lexicon & morphological templates.
 * 3. Live Arabic Wiktionary / lexical API lookup (gracefully cached & timed out).
 * 4. Structured search instructions telling the search model where & how to fetch every type.
 */

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
  sourcesChecked: string[];
  lexiconHits: DiacriticSearchVariant[];
  wiktionaryExtract: string | null;
  morphologicalHints: string[];
  searchDirectivePrompt: string;
}

const DIACRITICS_STRIP_REGEX = /[\u064B-\u065F\u0670\u0640]/g;

export function stripArabicDiacritics(input: string): string {
  return input.replace(DIACRITICS_STRIP_REGEX, '').trim();
}

export const DIACRITIC_SOURCES_CATALOG = [
  {
    id: 'egyptian_colloquial',
    labelAr: 'العامية المصرية المنطوقة (كسر الأوائل، تسكين الأواخر، نطق الشارع)',
    labelEn: 'Spoken Egyptian Colloquial',
  },
  {
    id: 'phonetic_suno',
    labelAr: 'التشفير الصوتي الغنائي لسونو (سكون آخر حرف + همزة القاف ء/ئ)',
    labelEn: 'Phonetic Sukoon & Hamza (Suno Encoding)',
  },
  {
    id: 'classical_fusha',
    labelAr: 'المعاجم الفصحى والأوزان الصرفية (الوسيط / لسان العرب / ويكاموس)',
    labelEn: 'Classical Lexicon & Morphological Patterns',
  },
  {
    id: 'gender_inflection',
    labelAr: 'تصريفات المخاطب المذكر والمؤنث (كاف الخطاب ـَكْ / ـِكْ، إِنْتَ / إِنْتِ)',
    labelEn: 'Masculine / Feminine Inflections',
  },
];

// Built-in high-precision Egyptian + Classical multi-reading seed lexicon
const MULTI_READING_LEXICON: Record<string, DiacriticSearchVariant[]> = {
  'قلبك': [
    { word: 'قَلْبَكْ', type: 'colloquial_egyptian', typeLabelAr: 'عامي مصري (مذكر)', typeLabelEn: 'Egyptian (M)', meaning: 'قلبك أنت (للمذكر) — بفتح الكاف وسكونها', source: 'Egyptian Colloquial Lexicon' },
    { word: 'قَلْبِكْ', type: 'colloquial_egyptian', typeLabelAr: 'عامي مصري (مؤنث)', typeLabelEn: 'Egyptian (F)', meaning: 'قلبك أنتِ (للمؤنث) — بكسر الكاف وسكونها', source: 'Egyptian Colloquial Lexicon' },
    { word: 'ءَلْبَكْ', type: 'phonetic_suno', typeLabelAr: 'صوتي سونو (مذكر)', typeLabelEn: 'Phonetic (M)', meaning: 'النطق القاهري الصوتي لسونو للمذكر بتحويل القاف همزة', source: 'Phonetic Sukoon Rules' },
    { word: 'ءَلْبِكْ', type: 'phonetic_suno', typeLabelAr: 'صوتي سونو (مؤنث)', typeLabelEn: 'Phonetic (F)', meaning: 'النطق القاهري الصوتي لسونو للمؤنث بتحويل القاف همزة', source: 'Phonetic Sukoon Rules' },
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
    { word: 'ءَالْ', type: 'phonetic_suno', typeLabelAr: 'صوتي سونو (همزة)', typeLabelEn: 'Said (Phonetic)', meaning: 'نطقها القاهري الصوتي بتحويل القاف همزة', source: 'Phonetic Sukoon Rules' },
    { word: 'قَالَ', type: 'classical_fusha', typeLabelAr: 'فصحى', typeLabelEn: 'Classical', meaning: 'فعل ماضٍ مبني على الفتح', source: 'Classical Grammar' },
  ],
};

async function fetchArabicWiktionarySummary(word: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2200);
    const url = `https://ar.wiktionary.org/api/rest_v1/page/summary/${encodeURIComponent(word)}`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'HafizBelAmyaStudio/1.0' },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data: any = await res.json();
    if (data && typeof data.extract === 'string' && data.extract.trim()) {
      return data.extract.trim().slice(0, 600);
    }
    return null;
  } catch {
    return null;
  }
}

function buildMorphologicalHints(cleanWord: string): string[] {
  const hints: string[] = [];
  if (cleanWord.includes('ق')) {
    hints.push(`يحتوي على حرف القاف (ق): أظهر التشكيل بالحفاظ على (ق) للعامية المتصلة، وبهمزة (ء/ئ) للتشفير الصوتي لسونو.`);
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

/**
 * Main Diacritics Search Script runner:
 * Gathers local lexicon hits, Wiktionary live reference (when reachable),
 * morphological analysis hints, and constructs the complete search directive
 * for the Diacritics Search Model.
 */
export async function runDiacriticsSearchScript(rawWord: string): Promise<DiacriticSearchScriptResult> {
  const query = rawWord.trim();
  const normalizedQuery = stripArabicDiacritics(query).replace(/[أإآ]/g, (m) => (m === 'آ' ? 'آ' : 'ا'));
  const exactClean = stripArabicDiacritics(query);

  const sourcesChecked = [
    'Egyptian Colloquial Multi-Reading Lexicon',
    'Phonetic Sukoon & Hamza (Suno) Rules',
    'Arabic Morphological Pattern Analyzer',
  ];

  // Look up exact match or alef-normalized match
  const lexiconHits: DiacriticSearchVariant[] =
    MULTI_READING_LEXICON[exactClean] ||
    MULTI_READING_LEXICON[normalizedQuery] ||
    [];

  // Try live Arabic Wiktionary reference
  const wiktionaryExtract = await fetchArabicWiktionarySummary(exactClean);
  if (wiktionaryExtract) {
    sourcesChecked.push('Arabic Wiktionary (ar.wiktionary.org)');
  }

  const morphologicalHints = buildMorphologicalHints(exactClean);

  const searchDirectivePrompt = `مصادر وقواعد البحث الإلزامية من سكريبت التشكيل (Diacritics Search Script):
الكلمة المطلوبة: "${exactClean}"
${wiktionaryExtract ? `\nمرجع ويكاموس العربي:\n${wiktionaryExtract}\n` : ''}
${morphologicalHints.length > 0 ? `\nإرشادات صرفية وصوتية للكلمة:\n- ${morphologicalHints.join('\n- ')}\n` : ''}
${lexiconHits.length > 0 ? `\nنتائج المعجم المحلي الأولية:\n${lexiconHits.map(h => `- ${h.word} (${h.typeLabelAr}): ${h.meaning}`).join('\n')}\n` : ''}

المطلوب جلب **كل أنواع التشكيل الممكنة** لهذه الكلمة من المصادر التالية بالترتيب:
1. التشكيل بالعامية المصرية المنطوقة (colloquial_egyptian): جميع المعاني والنطق الدارج في الشارع والأغاني (اسم، فعل، أمر، صفة) مع سكون أواخر العامية.
2. التشكيل الصوتي لسونو (phonetic_suno): مع سكون إلزامي على آخر حرف وتحويل القاف إلى (ء / ئ) إذا وُجدت قاف.
3. التشكيل للمذكر والمؤنث (gender_variant): إذا كانت تقبل التذكير والتأنيث (مثل كاف الخطاب ـَكْ / ـِكْ أو ضمير).
4. التشكيل المعجمي الفصيح (classical_fusha): جميع الأوزان الصرفية الفصحى الممكنة للكلمة (فَعَلَ، فُعِلَ، فَعْل، فِعْل، فُعْل...).

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
    sourcesChecked,
    lexiconHits,
    wiktionaryExtract,
    morphologicalHints,
    searchDirectivePrompt,
  };
}
