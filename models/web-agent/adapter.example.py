"""
Example adapter for Web Lyrics & Research AI Agent Model.
Rename this file to `infer.py` inside `models/web-agent/` to activate it automatically.

The backend pre-runs `models/scripts/web_scraper_agent.ts` to fetch the target
song website or run live web search, and passes the cleaned text + search hits
into your AI agent model.

Input JSON via stdin:
{
  "mode": "url" | "search",
  "url": "https://...",
  "query": "كلمات أغنية ...",
  "task": "extract_lyrics" | "diacritize_smart" | "analyze_and_prompt" | "custom",
  "customInstruction": "...",
  "fetchedPage": {
    "title": "...",
    "description": "...",
    "extractedText": "..."
  },
  "searchHits": [
    { "title": "...", "url": "...", "snippet": "..." }
  ],
  "language": "ar" | "en"
}

Expected stdout JSON:
{
  "text": "الكلمات المستخرجة أو النتيجة النهائية من الإيجنت الذكي"
}
"""
import json
import sys


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    raise NotImplementedError("Place your Web Agent model weights and implement infer.py")


if __name__ == "__main__":
    main()
