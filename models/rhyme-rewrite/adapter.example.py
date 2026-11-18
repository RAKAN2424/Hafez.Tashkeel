"""
Example adapter for Egyptian Rhymes & Line Rewriting Model.
Rename this file to `infer.py` inside `models/rhyme-rewrite/` to activate it automatically.

Input JSON via stdin (Rhymes):
{
  "task": "rhymes",
  "word": "قلبي",
  "language": "ar"
}
Expected stdout JSON: { "rhymes": ["دَرْبِيْ", "حَرْبِيْ", ...] }

Input JSON via stdin (Rewrite):
{
  "task": "rewrite",
  "line": "...",
  "context": "...",
  "language": "ar"
}
Expected stdout JSON: { "text": "السطر المعاد صياغته بنفس الوزن والقافية" }
"""
import json
import sys


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    raise NotImplementedError("Place your rhyme/rewrite model and implement infer.py")


if __name__ == "__main__":
    main()
