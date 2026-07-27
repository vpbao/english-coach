#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.9"
# dependencies = ["edge-tts>=6.1"]
# ///
"""
Generate MP3 audio for the 33 shadowing scripts using Microsoft Edge neural TTS.
FREE — no API key and no billing required. Natural en-US voices.

USAGE (with uv — recommended)
-----
1. cd web
2. uv run generate_audio_edge.py        (uv auto-installs edge-tts; needs internet)

Files land in web/audio/<set_id>.mp3. Re-running skips existing files
(pass --force to regenerate). Pick a voice with EDGE_VOICE=..., e.g.:
  en-US-AriaNeural  (female, default)   en-US-GuyNeural   (male)
  en-US-JennyNeural (female)            en-GB-RyanNeural  (British male)
List all voices:  uv run --with edge-tts edge-tts --list-voices
"""
import asyncio
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_JSON = os.path.join(os.path.dirname(HERE), "english-coach-data.json")
DATA_JS = os.path.join(HERE, "data.js")
OUT = os.path.join(HERE, "audio")

VOICE = os.environ.get("EDGE_VOICE", "en-US-AriaNeural")        # the candidate (answer)
VOICE_Q = os.environ.get("EDGE_VOICE_Q", "en-US-GuyNeural")     # the interviewer (question)
RATE = os.environ.get("EDGE_RATE", "-8%")   # slightly slower for interview pace
FORCE = "--force" in sys.argv


def load_sets():
    if os.path.exists(DATA_JSON):
        with open(DATA_JSON, encoding="utf-8") as f:
            return json.load(f)["shadowing_sets"]
    with open(DATA_JS, encoding="utf-8") as f:
        raw = f.read()
    raw = raw[raw.index("{"): raw.rindex("}") + 1]
    return json.loads(raw)["shadowing_sets"]


async def main():
    import edge_tts

    os.makedirs(OUT, exist_ok=True)
    sets = load_sets()
    print(f"{len(sets)} sets · answer={VOICE} · interviewer={VOICE_Q} · rate={RATE}\n")

    # Build the job list: answer clip (<id>.mp3) + interviewer clip (<id>_q.mp3)
    jobs = []  # (filename, text, voice, rate)
    for s in sets:
        sid = s["set_id"]
        ans = (s.get("shadowing_script") or "").strip()
        if ans:
            jobs.append((f"{sid}.mp3", ans, VOICE, RATE))
        q = (s.get("interviewer_line") or "").strip()
        if q:
            jobs.append((f"{sid}_q.mp3", q, VOICE_Q, "+0%"))

    made = skipped = 0
    for fname, text, v, r in jobs:
        path = os.path.join(OUT, fname)
        if os.path.exists(path) and not FORCE:
            skipped += 1
            print(f"  skip  {fname} (exists)")
            continue
        try:
            await edge_tts.Communicate(text, v, rate=r).save(path)
            made += 1
            print(f"  ok    {fname}")
        except Exception as e:
            print(f"  FAIL  {fname}: {e}")

    print(f"\nDone. {made} created, {skipped} skipped -> {OUT}")


if __name__ == "__main__":
    asyncio.run(main())
