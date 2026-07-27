# English Coach — Web Trainer

A static, no-backend web app for daily interview-English practice across six stations:
Listening → Echoing → Shadowing → Dictation → Reading → Speaking + Writing (~120 min/day).

It reads `data.js` (generated from `../english-coach-data.json`) and works for all 90 days.
Progress, self-scores and learned sentences are saved in the browser (localStorage).

## Division of labour

- **This app** = your automated practice room. It handles the objective, self-checkable
  parts: play audio (browser voice or MP3), record you (speech-to-text), score word-match
  for shadowing/reading, and auto-grade dictation.
- **Claude / ChatGPT voice** = the real judge. The last station builds an *Export prompt*
  (spoken transcript + written answer + self-scores + stuck points). Copy it, paste into a
  voice chat, and let the AI evaluate your speaking/communication and run a mock interview.

## Run locally

Just open `index.html` in Chrome or Edge (speech features need Chromium).
For a server-like run:

```bash
cd web
python3 -m http.server 8000    # then open http://localhost:8000
```

## Deploy

### Vercel
```bash
npm i -g vercel
cd web
vercel            # first run: log in + confirm; deploys this folder
vercel --prod     # promote to production URL
```
Or on vercel.com: New Project → import the repo → set **Root Directory = web** → Deploy.

### GitHub Pages
Push the repo, then Settings → Pages → deploy from branch. If the app lives in `/web`,
either set the Pages source folder to `web`, or move these files to the repo root / `docs/`.

## Audio: browser voice vs MP3 files

By default the app speaks with the **browser's built-in voice**. That needs no setup, but it
depends on the device having speech voices installed — so on some machines, phones, or hosts
it can be silent. For reliable playback everywhere (including Vercel), generate **MP3 files**;
then the app plays plain `<audio>` clips that work in every browser.

The generator renders two clips per lesson: the answer (`<set_id>.mp3`) and the interviewer's
question (`<set_id>_q.mp3`), so the whole "Play as interview" scene comes from files.

Recommended — free, no key (Microsoft Edge neural TTS):

```bash
cd web
uv run generate_audio_edge.py          # uv auto-installs edge-tts; writes web/audio/*.mp3
```

Or with OpenAI (needs a key + billing enabled):

```bash
cd web
export OPENAI_API_KEY=sk-...
uv run generate_audio.py
```

Then switch the app to MP3 mode: in `app.js` change `let USE_MP3 = ...` to `let USE_MP3 = true;`

For a deployed site (Vercel/Pages) you must **commit the `web/audio/` folder and redeploy**,
because the MP3s are served as static files. Options: `EDGE_VOICE` (answer voice),
`EDGE_VOICE_Q` (interviewer voice), `--force` to regenerate.

## Files

- `index.html`, `style.css`, `app.js` — the app
- `data.js` — embedded lesson data (regenerate if the JSON changes; see below)
- `generate_audio.py` — optional TTS audio generator
- `audio/` — optional generated MP3s

Regenerate `data.js` after editing the source plan:

```bash
python3 -c "import json;d={k:json.load(open('../english-coach-data.json'))[k] for k in ['program','student','cv_profile','project_stories','topics','daily_plan','shadowing_sets','sentence_bank','coach_rubric','daily_routine']};open('data.js','w',encoding='utf-8').write('window.COACH_DATA = '+json.dumps(d,ensure_ascii=False)+';\n')"
```
