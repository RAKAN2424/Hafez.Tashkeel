export const PHONETIC_ENCODING_RULES = `**قواعد التشكيل والكتابة للعامية المصرية (طريقة المستخدم الاحترافية للأغاني والشعر وسونو):**

1. السكون الإلزامي الصريح في آخر كل كلمة (100% بلا استثناء):
   - كل كلمة في السطر يجب أن تنتهي بسكون صريح (ْ) على حرفها الأخير.
   - الكلمات المنتهية بحرف ساكن أصلي: يُوضع عليه سكون (يَوْمْ، فَتَحْتْ، سَاكِتْ، فِرِحْتْ، كَمَانْ، عَشَانْ، مِحْتَاجْ، إِلْفَرَحْ، اتْبَهْدِلْتْ، وَاتْمَرْمَطْ، وَاعْتَرَضْتْ، وَاتْحَمَّلْتْ).
   - الكلمات المنتهية بحرف مد (ألف اْ، ياء يْ، واو وْ): سكون صريح على حرف المد (أَنَاْ، مَاْ، لَاْ، وَلَاْ، مَاشِيْ، رَاضِيْ، عُمْرِيْ، غَنِيْ، بَئِيْ، يَجِييْ، إِلْدُنْيَاْ).
   - الكلمات المنتهية بألف لينة (ى): سكون صريح عليها (حَتَّىْ، اشْتَرَىْ).
   - الكلمات المنتهية بهاء: تكتب هاءً مسكنة بسكون صريح (هْ) (وَاسْطَهْ، جُمْلَهْ، بِحَالُهْ).
   - ممنوع منعاً باتاً ترك أي كلمة في السطر دون سكون على آخر حرف فيها!

2. تحويل حرف القاف (ق) تماماً إلى همزة على السطر (ء) أو همزة على الياء/نبرة (ئـ / ئ):
   - حرف القاف في العامية المصرية يُنطق همزة، ويُكتب حصراً كالتالي:
     * إما همزة على السطر (ء / ءْ): مثل (مَعْءُولْ، ءَلْبِيْ، ءَالْ، نَطَءْتْ، حَءّْ، طَرِيءْ، ءَرِيبْ).
     * أو همزة على الياء / نبرة (ئـ / ئ / ئْ): مثل (بَئِيْ، مَعْئُولْ، يِئُولْ، ئَلْبِيْ، ئَالْ، نَطَئْتْ، دِئِيقَهْ، لِئِيتْ).
   - ممنوع كتابة حرف القاف "ق" نهائياً في الكلمات العامية.
   - ممنوع كتابتها كهمزة على ألف "أ" (لا تكتب نطأت ولا معأول، بل نطءت / نطئت / معءول / معئول).

3. الكلمات متصلة وطبيعية مع التشكيل الصوتي التام:
   - الكلمة كتلة واحدة متصلة كأي كلمة عادية، وتكون المسافة فقط بين الكلمة والتي تليها.
   - ضبط الحركات الداخلية (فتحة، كسرة، ضمة، سكون، شدة) لتعكس النطق والوزن الغنائي المصري الأصيل.
   - كسر همزة الوصل صراحة في الكلمات التي تبدأ بساكن: (اِتْوَلَدْتْ، اِتْبَهْدِلْتْ، اِلْفَرَحْ، اِلْدُنْيَاْ، اِشْتَرَىْ).

النموذج الإلزامي الصارم للتطبيق (يحتذى به حرفياً):
أَنَاْ مِنْ يَوْمْ مَاْ اتْوَلَدْتْ اتْبَهْدِلْتْ وَاتْمَرْمَطْ
لَاْ فَتَحْتْ بَئِيْ وَاعْتَرَضْتْ وَلَاْ حَتَّىْ نَطَءْتْ
وَفِضِلْتْ مَاشِيْ سَاكِتْ وَرَاضِيْ وَاتْحَمَّلْتْ
مَعْءُولْ يِعِدِّيْ عُمْرِيْ بِحَالُهْ وَلَاْ يَوْمْ فِرِحْتْ
وَلَاْ إِلْفَرَحْ كَمَانْ عَشَانْ يَجِييْ مِحْتَاجْ وَاسْطَهْ
وَلَاْ فْحَدّْ غَنِيْ اشْتَرَىْ إِلْفَرَحْ مِنْ إِلْدُنْيَاْ جُمْلَهْ`;

export const ensureEgyptianPhoneticRules = (text: string): string => {
  if (!text) return text;
  const sukoon = '\u0652';
  const diacritics = /[\u064B-\u0652\u0670]/;
  const arabicChar = /[\u0600-\u06FF]/;

  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('[') || (trimmed.startsWith('*') && trimmed.endsWith('*'))) {
        return line;
      }

      const words = line.split(' ');
      return words
        .map((rawWord) => {
          if (!rawWord.trim()) return rawWord;
          if (!arabicChar.test(rawWord)) return rawWord;

          let w = rawWord;

          w = w.replace(/بَقِي|بقي|بَقي|بَءِي|بَأِي/g, 'بَئِي');
          w = w.replace(/بَقِيت|بقيت|بَقيت|بَءِيت|بَأِيت/g, 'بَئِيت');
          w = w.replace(/لَقِيت|لقيت|لَقيت|لِءِيت/g, 'لِئِيت');
          w = w.replace(/يَقُول|يقول/g, 'يِئُول');

          w = w.replace(/نَطَقْت|نطقت|نَطَأْت/g, 'نَطَءْت');
          w = w.replace(/مَعْقُول|معقول|مَعْأُول/g, 'مَعْءُول');
          w = w.replace(/قَلْبِي|قلبي/g, 'ءَلْبِي');
          w = w.replace(/قَال|قال/g, 'ءَال');
          w = w.replace(/حَقّ|حق/g, 'حَءّ');
          w = w.replace(/طَرِيق|طريق/g, 'طَرِيء');
          w = w.replace(/دَقِيقَة|دقيقه|دقيقة/g, 'دِءِيقَه');

          w = w.replace(/ق/g, 'ء');

          let trailingPunct = '';
          while (w.length > 0 && /[،,\.!?؟:؛"']/.test(w[w.length - 1])) {
            trailingPunct = w[w.length - 1] + trailingPunct;
            w = w.slice(0, -1);
          }

          if (/[ًٌٍَُِ]$/.test(w)) {
            w = w.replace(/[ًٌٍَُِ]+$/, sukoon);
          }
          if (w.length > 0 && arabicChar.test(w)) {
            if (!w.endsWith(sukoon)) {
              const lastChar = w[w.length - 1];
              if (diacritics.test(lastChar)) {
                w = w.slice(0, -1) + sukoon;
              } else {
                w = w + sukoon;
              }
            }
          }

          return w + trailingPunct;
        })
        .join(' ');
    })
    .join('\n');
};

export const ensureSmartLightDiacriticsRules = (
  text: string,
  originalInput?: string,
  genderPreference: 'auto' | 'masculine' | 'feminine' = 'auto'
): string => {
  if (!text) return text;
  let clean = text;
  const sukoon = '\u0652';
  const diacritics = /[\u064B-\u0652\u0670]/;
  const arabicChar = /[\u0600-\u06FF]/;
  const diacriticsRegex = /[\u064B-\u065F\u0670\u0640]/g;

  let isFeminine = genderPreference === 'feminine';
  if (genderPreference === 'auto') {
    const rawForCheck = (originalInput || text).replace(diacriticsRegex, '');
    const femPatterns = [
      /(^|\s)(إنتِ|انتي|إنتي|يا\s*حبيبتي|حبيبتي|يا\s*بنت|يا\s*أختي|يا\s*عروسة)($|\s|[،,\.!?؟:؛"'])/,
      /(^|\s)(شفتكِ|شفتِك|عايزاكِ|بحبكِ|معاكِ|ليكي|معاكي|عاملة|رايحة|جاية|فاكرة|شايفة|عارفة)($|\s|[،,\.!?؟:؛"'])/,
    ];
    if (femPatterns.some((p) => p.test(rawForCheck))) {
      isFeminine = true;
    }
  }

  clean = clean
    .replace(/[ءئ][\u064B-\u065F\u0670]*ل[\u064B-\u065F\u0670]*ب/g, 'قَلْب')
    .replace(/م[\u064B-\u065F\u0670]*ع[\u064B-\u065F\u0670]*[ءئ][\u064B-\u065F\u0670]*و[\u064B-\u065F\u0670]*ل/g, 'مَعْقُول')
    .replace(/[ءئ][\u064B-\u065F\u0670]*ا[\u064B-\u065F\u0670]*ل/g, 'قَال')
    .replace(/ي[\u064B-\u065F\u0670]*[ءئ][\u064B-\u065F\u0670]*و[\u064B-\u065F\u0670]*ل/g, 'يِقُول')
    .replace(/ن[\u064B-\u065F\u0670]*ط[\u064B-\u065F\u0670]*[ءئ]/g, 'نَطَق')
    .replace(/ح[\u064B-\u065F\u0670]*[ءئّ]/g, 'حَقّ')
    .replace(/ط[\u064B-\u065F\u0670]*ر[\u064B-\u065F\u0670]*ي[\u064B-\u065F\u0670]*[ءئ]/g, 'طَرِيق')
    .replace(/د[\u064B-\u065F\u0670]*[ءئ][\u064B-\u065F\u0670]*ي[\u064B-\u065F\u0670]*[ءئ]/g, 'دَقِيق')
    .replace(/ب[\u064B-\u065F\u0670]*[ءئ]ي/g, 'بَقِي')
    .replace(/ل[\u064B-\u065F\u0670]*[ءئ]يت/g, 'لَقِيت')
    .replace(/خ[\u064B-\u065F\u0670]*ل[\u064B-\u065F\u0670]*[ءئ]/g, 'خَلَق')
    .replace(/[ءئ][\u064B-\u065F\u0670]*د[\u064B-\u065F\u0670]*ر/g, 'قَدَر');

  if (originalInput && originalInput.includes('ق')) {
    const origWords = originalInput.trim().split(/\s+/);
    const qafBases = origWords
      .map((w) => w.replace(diacriticsRegex, '').replace(/[،,\.!?؟:؛"']/g, ''))
      .filter((w) => w.includes('ق') && w.length >= 2);

    const words = clean.split(' ');
    clean = words
      .map((w) => {
        const pureW = w.replace(diacriticsRegex, '').replace(/[،,\.!?؟:؛"']/g, '');
        for (const base of qafBases) {
          const hamzaBase1 = base.replace(/ق/g, 'ء');
          const hamzaBase2 = base.replace(/ق/g, 'ئ');
          if (pureW === hamzaBase1 || pureW === hamzaBase2) {
            return w.replace(/[ءئ]/g, 'ق');
          }
        }
        return w;
      })
      .join(' ');
  }

  clean = clean.replace(/(?<![إا]ن)ت\u064E(?=\s|[،,\.!?؟:؛"']|$)/g, 'ت' + sukoon);

  return clean
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('[') || (trimmed.startsWith('*') && trimmed.endsWith('*'))) {
        return line;
      }

      const words = line.split(' ');
      return words
        .map((rawWord) => {
          if (!rawWord.trim()) return rawWord;
          if (!arabicChar.test(rawWord)) return rawWord;

          let w = rawWord;

          let leadingPunct = '';
          while (w.length > 0 && /[،,\.!?؟:؛"'\(\)\[\]{}«»]/.test(w[0])) {
            leadingPunct += w[0];
            w = w.slice(1);
          }

          let trailingPunct = '';
          while (w.length > 0 && /[،,\.!?؟:؛"'\(\)\[\]{}«»]/.test(w[w.length - 1])) {
            trailingPunct = w[w.length - 1] + trailingPunct;
            w = w.slice(0, -1);
          }

          const pureWord = w.replace(diacriticsRegex, '');

          const endsWithKaf = /ك$/.test(pureWord);
          if (endsWithKaf) {
            if (/[يا][\u064B-\u0652\u0670]*ك[\u064B-\u0652\u0670]*$/.test(w)) {
              w = isFeminine ? w.replace(/ك[\u064B-\u0652\u0670]*$/, 'كِ') : w.replace(/ك[\u064B-\u0652\u0670]*$/, 'كْ');
            } else {
              w = isFeminine
                ? w.replace(/[َِ]?ك[\u064B-\u0652\u0670]*$/, 'ِكْ')
                : w.replace(/[َِ]?ك[\u064B-\u0652\u0670]*$/, 'َكْ');
            }
          }

          if (/^[إا]نْ?تَ?$/i.test(pureWord)) {
            w = isFeminine ? 'إِنْتِ' : 'إِنْتَ';
          }

          if (/[ًٌٍَُِ]$/.test(w) && !/[َِ]كْ?$/.test(w) && w !== 'إِنْتَ' && w !== 'إِنْتِ') {
            w = w.replace(/[ًٌٍَُِ]+$/, sukoon);
          }

          if (w.length > 0 && arabicChar.test(w) && w !== 'إِنْتَ' && w !== 'إِنْتِ' && !w.endsWith('كِ')) {
            if (!w.endsWith(sukoon)) {
              const lastChar = w[w.length - 1];
              if (diacritics.test(lastChar)) {
                w = w.slice(0, -1) + sukoon;
              } else {
                w = w + sukoon;
              }
            }
          }

          return leadingPunct + w + trailingPunct;
        })
        .join(' ');
    })
    .join('\n');
};

export const ensureConnectedDiacriticsRules = (
  text: string,
  originalInput?: string,
  genderPreference: 'auto' | 'masculine' | 'feminine' = 'auto'
): string => {
  if (!text) return text;
  let clean = text;
  const sukoon = '\u0652';
  const diacritics = /[\u064B-\u0652\u0670]/;
  const arabicChar = /[\u0600-\u06FF]/;
  const diacriticsRegex = /[\u064B-\u065F\u0670\u0640]/g;

  clean = clean
    .replace(/[ءئ][\u064B-\u065F\u0670]*ل[\u064B-\u065F\u0670]*ب/g, 'قَلْب')
    .replace(/م[\u064B-\u065F\u0670]*ع[\u064B-\u065F\u0670]*[ءئ][\u064B-\u065F\u0670]*و[\u064B-\u065F\u0670]*ل/g, 'مَعْقُول')
    .replace(/[ءئ][\u064B-\u065F\u0670]*ا[\u064B-\u065F\u0670]*ل/g, 'قَال')
    .replace(/ي[\u064B-\u065F\u0670]*[ءئ][\u064B-\u065F\u0670]*و[\u064B-\u065F\u0670]*ل/g, 'يِقُول')
    .replace(/ط[\u064B-\u065F\u0670]*ر[\u064B-\u065F\u0670]*ي[\u064B-\u065F\u0670]*[ءئ]/g, 'طَرِيق');

  if (originalInput && originalInput.includes('ق')) {
    const origWords = originalInput.trim().split(/\s+/);
    const qafBases = origWords
      .map((w) => w.replace(diacriticsRegex, '').replace(/[،,\.!?؟:؛"']/g, ''))
      .filter((w) => w.includes('ق') && w.length >= 2);

    const words = clean.split(' ');
    clean = words
      .map((w) => {
        const pureW = w.replace(diacriticsRegex, '').replace(/[،,\.!?؟:؛"']/g, '');
        for (const base of qafBases) {
          if (pureW === base.replace(/ق/g, 'ء') || pureW === base.replace(/ق/g, 'ئ')) {
            return w.replace(/[ءئ]/g, 'ق');
          }
        }
        return w;
      })
      .join(' ');
  }

  return clean
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('[') || (trimmed.startsWith('*') && trimmed.endsWith('*'))) {
        return line;
      }

      const words = line.split(' ');
      return words
        .map((rawWord) => {
          if (!rawWord.trim()) return rawWord;
          if (!arabicChar.test(rawWord)) return rawWord;

          let w = rawWord;
          let trailingPunct = '';
          while (w.length > 0 && /[،,\.!?؟:؛"']/.test(w[w.length - 1])) {
            trailingPunct = w[w.length - 1] + trailingPunct;
            w = w.slice(0, -1);
          }

          const pureWord = w.replace(diacriticsRegex, '');

          if (/ك$/.test(pureWord)) {
            if (genderPreference === 'feminine') {
              w = w.replace(/[َِ]?ك[\u064B-\u0652\u0670]*$/g, 'ِكْ');
            } else {
              w = w.replace(/[َِ]?ك[\u064B-\u0652\u0670]*$/g, 'َكْ');
            }
          }

          if (/[ًٌٍَُِ]$/.test(w) && !/[َِ]كْ$/.test(w)) {
            w = w.replace(/[ًٌٍَُِ]+$/, sukoon);
          }

          if (w.length > 0 && arabicChar.test(w) && !w.endsWith(sukoon)) {
            const lastChar = w[w.length - 1];
            if (diacritics.test(lastChar)) {
              w = w.slice(0, -1) + sukoon;
            } else {
              w = w + sukoon;
            }
          }

          return w + trailingPunct;
        })
        .join(' ');
    })
    .join('\n');
};
