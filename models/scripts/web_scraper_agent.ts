/**
 * Web Lyrics & Website Research Agent Script
 * (سكريبت إيجنت مواقع الأغاني والبحث على الإنترنت)
 *
 * Capabilities:
 * 1. Fetch & safely clean HTML from any song website URL (SSRF-protected).
 * 2. Search the web for song lyrics, artists, or music metadata.
 * 3. Prepare clean structured context for the user's Smart AI Agent Model.
 */

import net from 'net';

export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface WebsiteFetchResult {
  url: string;
  title: string;
  description: string;
  extractedText: string;
  charCount: number;
  fetchedAt: string;
}

function isPrivateOrBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (
    lower === 'localhost' ||
    lower === '0.0.0.0' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return true;
  }

  if (net.isIP(lower)) {
    if (lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) {
      return true;
    }
    const parts = lower.split('.').map(Number);
    if (parts.length === 4) {
      const [a, b] = parts;
      if (
        a === 10 ||
        a === 127 ||
        a === 0 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168)
      ) {
        return true;
      }
    }
  }
  return false;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function extractReadableTextFromHtml(html: string): {
  title: string;
  description: string;
  extractedText: string;
} {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1].replace(/\s+/g, ' ').trim()) : '';

  const descMatch =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  const description = descMatch ? decodeHtmlEntities(descMatch[1].trim()) : '';

  // Remove non-content blocks first
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '\n')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '\n')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '\n')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '\n')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '\n')
    .replace(/<!--[\s\S]*?-->/g, '\n');

  // Preserve line breaks for lyrics & structured sections
  body = body
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  const cleanedLines = decodeHtmlEntities(body)
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0);

  const extractedText = cleanedLines.join('\n').slice(0, 14000);
  return { title, description, extractedText };
}

export async function fetchWebsiteContent(rawUrl: string): Promise<WebsiteFetchResult> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('رابط الموقع غير صالح (يرجى إدخال رابط يبدأ بـ https:// أو http://)');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('يُسمح فقط بروابط http و https');
  }

  if (isPrivateOrBlockedHost(parsed.hostname)) {
    throw new Error('هذا النطاق محظور لأسباب أمنية.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(parsed.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
      },
    });
    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`تعذر قراءة الصفحة (HTTP ${res.status})`);
    }

    const rawText = await res.text();
    const { title, description, extractedText } = extractReadableTextFromHtml(rawText);

    return {
      url: parsed.toString(),
      title,
      description,
      extractedText,
      charCount: extractedText.length,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    clearTimeout(timer);
    if (err?.name === 'AbortError') {
      throw new Error('انتهت مهلة الاتصال بالموقع. حاول مرة أخرى أو جرب رابطاً آخر.');
    }
    throw err;
  }
}

export async function searchWebForLyrics(query: string): Promise<WebSearchHit[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
      },
    });
    clearTimeout(timer);
    if (!res.ok) return [];

    const html = await res.text();
    const hits: WebSearchHit[] = [];
    const blockRegex =
      /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

    let match: RegExpExecArray | null;
    while ((match = blockRegex.exec(html)) !== null && hits.length < 6) {
      let href = match[1];
      // Unwrap DuckDuckGo redirect URLs if present
      const uddgMatch = href.match(/[?&]uddg=([^&]+)/);
      if (uddgMatch) {
        try {
          href = decodeURIComponent(uddgMatch[1]);
        } catch {
          // keep original
        }
      }
      const title = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
      const snippet = decodeHtmlEntities(match[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
      if (title && snippet) {
        hits.push({ title, url: href, snippet });
      }
    }
    return hits;
  } catch {
    return [];
  }
}
