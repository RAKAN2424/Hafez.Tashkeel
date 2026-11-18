"""
Example adapter for Music Prompt Generator Model (Suno / Udio).
Rename this file to `infer.py` inside `models/prompt-generator/` to activate it automatically.

Input JSON via stdin:
{
  "genre": "mahraganat",
  "mood": "حماسي",
  "lyrics": "...",
  "language": "ar"
}

Expected stdout JSON:
{
  "text": "[Style: ...]\\n[Instruments: ...]\\n..."
}
"""
import json
import sys


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    raise NotImplementedError("Place your prompt generator model and implement infer.py")


if __name__ == "__main__":
    main()
