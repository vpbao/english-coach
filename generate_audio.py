#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.9"
# dependencies = ["openai>=1.40"]
# ///
"""
Generate high-quality MP3 audio for the 33 shadowing scripts using OpenAI TTS.
The web app uses web/audio/<set_id>.mp3 when USE_MP3 is on, and falls back to the
browser's built-in voice otherwise — so this step is OPTIONAL.

USAGE (with uv — recommended, no manual venv/install)
-----
1. export OPENAI_API_KEY=sk-...            (Windows PowerShell: $env:OPENAI_API_KEY="sk-...")
2. uv run generate_audio.py                 (uv installs openai automatically)

Or without uv:  pip install openai  &&  python generate_audio.py

Run it from the `web/` folder (next to data.js). Files land in web/audio/.
Cost is a few cents for all 33 clips. Re-running skips existing files
(pass --force to regenerate). Pick a voice with TTS_VOICE=onyx, etc.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_JS = os.path.join(HERE, "data.js")
DATA_JSON = os.path.join(os.path.dirname(HERE), "english-coach-data.json")
OUT = os.path.join(HERE, "audio")

VOICE = os.environ.get("TTS_VOICE", "alloy")   # alloy, echo, fable, onyx, nova, shimmer
MODEL = os.environ.get("TTS_MODEL", "gpt-4o-mini-tts")  # or "tts-1", "tts-1-hd"
FORCE = "--force" in sys.argv


def load_sets():
    # Prefer the canonical JSON; fall back to parsing data.js.
    if os.path.exists(DATA_JSON):
        with open(DATA_JSON, encoding="utf-8") as f:
            return json.load(f)["shadowing_sets"]
    with open(DATA_JS, encoding="utf-8") as f:
        raw = f.read()
    raw = raw[raw.index("{"): raw.rindex("}") + 1]
    return json.loads(raw)["shadowing_sets"]


def main():
    try:
        from openai import OpenAI
    except ImportError:
        sys.exit("Missing dependency. Run: pip install openai")
    if not os.environ.get("OPENAI_API_KEY"):
        sys.exit("Set OPENAI_API_KEY first (export OPENAI_API_KEY=sk-...).")

    client = OpenAI()
    os.makedirs(OUT, exist_ok=True)
    sets = load_sets()
    print(f"{len(sets)} shadowing scripts · voice={VOICE} · model={MODEL}\n")

    made = skipped = 0
    for s in sets:
        sid = s["set_id"]
        text = (s.get("shadowing_script") or "").strip()
        if not text:
            continue
        path = os.path.join(OUT, f"{sid}.mp3")
        if os.path.exists(path) and not FORCE:
            skipped += 1
            print(f"  skip  {sid}.mp3 (exists)")
            continue
        try:
            with client.audio.speech.with_streaming_response.create(
                model=MODEL, voice=VOICE, input=text,
                instructions="Speak clearly and naturally at a slightly measured interview pace.",
            ) as resp:
                resp.stream_to_file(path)
            made += 1
            print(f"  ok    {sid}.mp3")
        except Exception as e:
            print(f"  FAIL  {sid}: {e}")

    print(f"\nDone. {made} created, {skipped} skipped -> {OUT}")


if __name__ == "__main__":
    main()
