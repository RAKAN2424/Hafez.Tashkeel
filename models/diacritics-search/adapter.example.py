"""
Example adapter for All-Types Diacritics Search Model.
Rename this file to `infer.py` inside `models/diacritics-search/` to activate it automatically.

The backend pre-runs `models/scripts/diacritics_search.ts` and passes all gathered
lexicon hits, Wiktionary summaries, and morphological hints in `scriptContext`.

Input JSON via stdin:
{
  "word": "قلبك",
  "scriptContext": {
    "normalizedQuery": "قلبك",
    "sourcesChecked": [...],
    "lexiconHits": [...],
    "wiktionaryExtract": "...",
    "morphologicalHints": [...]
  }
}

Expected stdout JSON:
{
  "suggestions": [
    {
      "word": "قَلْبَكْ",
      "type": "colloquial_egyptian",
      "typeLabel": "عامي مصري (مذكر)",
      "meaning": "...",
      "source": "..."
    }
  ],
  "synonyms": ["..."],
  "antonyms": ["..."]
}
"""
import json
import sys


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    raise NotImplementedError("Place your diacritics search model and implement infer.py")


if __name__ == "__main__":
    main()
