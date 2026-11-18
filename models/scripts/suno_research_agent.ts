/**
 * Suno Latest Models & Prompt Research Script
 * (سكريبت البحث على الإنترنت عن أحدث موديلات Suno وطرق كتابة البرومبت)
 *
 * Executed automatically before Prompt Generation / Suno Song Composition
 * when internet access is enabled for the model.
 */

export interface SunoResearchSnippet {
  title: string;
  url: string;
  snippet: string;
}

export interface SunoResearchResult {
  internetConnected: boolean;
  fetchedAt: string;
  sourcesChecked: string[];
  liveSnippets: SunoResearchSnippet[];
  latestModelNotes: string;
  sunoPromptDirective: string;
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

async function searchDuckDuckGoForSuno(query: string): Promise<SunoResearchSnippet[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    clearTimeout(timer);
    if (!res.ok) return [];

    const html = await res.text();
    const snippets: SunoResearchSnippet[] = [];
    const blockRegex =
      /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

    let match: RegExpExecArray | null;
    while ((match = blockRegex.exec(html)) !== null && snippets.length < 5) {
      const rawHref = match[1];
      const title = stripHtmlTags(match[2]);
      const snippet = stripHtmlTags(match[3]);
      if (title && snippet) {
        snippets.push({
          title,
          url: rawHref,
          snippet: snippet.slice(0, 280),
        });
      }
    }
    return snippets;
  } catch {
    return [];
  }
}

export async function runSunoResearchScript(options: {
  enableWebSearch?: boolean;
  genre?: string;
  mood?: string;
}): Promise<SunoResearchResult> {
  const enableWebSearch = options.enableWebSearch !== false;
  const fetchedAt = new Date().toISOString();
  const sourcesChecked: string[] = ['Suno Prompt Architecture Reference'];
  let liveSnippets: SunoResearchSnippet[] = [];

  if (enableWebSearch) {
    const query = `Suno AI latest model version v4 v4.5 v5 metatags style prompt guide ${options.genre || ''}`.trim();
    const ddgResults = await searchDuckDuckGoForSuno(query);
    if (ddgResults.length > 0) {
      liveSnippets = ddgResults;
      sourcesChecked.push('Live Web Search (DuckDuckGo Index)');
    }
    sourcesChecked.push('Google Search Grounding (Active when connected)');
  }

  const latestModelNotes = liveSnippets.length > 0
    ? liveSnippets.map((s) => `- ${s.title}: ${s.snippet}`).join('\n')
    : 'استخدم أحدث معايير Suno (v4 / v4.5+): وصف الأسلوب والآلات والسرعة (BPM) والمقام بدقة في خانة Style (حد أقصى 200-1000 حرف حسب النسخة)، واستخدم وسوم الهيكلة مثل [Intro], [Verse], [Pre-Chorus], [Chorus], [Bridge], [Instrumental Break], [Outro]، وتجنب ذكر أسماء فنانين محميين بحقوق النشر.';

  const sunoPromptDirective = `[توجيهات سكريبت البحث عن أحدث موديلات Suno]
حالة الاتصال بالإنترنت: ${enableWebSearch ? 'متصل (Live Search Enabled)' : 'وضع محلي (Offline Mode)'}
تاريخ الفحص: ${fetchedAt}
${liveSnippets.length > 0 ? `\nنتائج البحث الحية من الإنترنت عن Suno:\n${latestModelNotes}\n` : `\nمرجع Suno المحدث:\n${latestModelNotes}\n`}
المطلوب من الموديل:
1. تحديد أحدث نسخة/ممارسة مناسبة في Suno (مثل v4 / v4.5 / v5) بناءً على البحث المتاح.
2. كتابة برومبت إنجليزي احترافي جاهز للنسخ (Style Prompt + Metatags + Vocal Delivery + Mix/Mastering cues) متوافق مع حدود Suno الحديثة.
3. إرفاق شرح عربي مختصر لأحدث الميزات المستخدمة في البرومبت.`;

  return {
    internetConnected: enableWebSearch,
    fetchedAt,
    sourcesChecked,
    liveSnippets,
    latestModelNotes,
    sunoPromptDirective,
  };
}
