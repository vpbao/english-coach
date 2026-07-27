/* English Coach — static speaking/listening trainer
   Reads window.COACH_DATA (data.js). No backend. Progress in localStorage. */
(function () {
  "use strict";
  const D = window.COACH_DATA;
  if (!D) {
    document.body.innerHTML =
      "<p style='padding:24px'>data.js failed to load.</p>";
    return;
  }

  // ---------- helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, attrs = {}, kids = []) => {
    const n = document.createElement(tag);
    for (const k in attrs) {
      if (k === "class") n.className = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else if (k.startsWith("on") && typeof attrs[k] === "function")
        n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    (Array.isArray(kids) ? kids : [kids]).forEach(
      (c) =>
        c &&
        n.appendChild(typeof c === "string" ? document.createTextNode(c) : c),
    );
    return n;
  };
  const norm = (s) =>
    (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const words = (s) => norm(s).split(" ").filter(Boolean);
  const toast = (msg) => {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(t._t);
    t._t = setTimeout(() => (t.hidden = true), 2200);
  };
  const splitSentences = (txt) =>
    (txt || "")
      .match(/[^.!?]+[.!?]*/g)
      ?.map((s) => s.trim())
      .filter(Boolean) || [];

  // ---------- storage (localStorage with in-memory fallback) ----------
  const SKEY = "englishCoachProgress.v1";
  let LS = null;
  try {
    LS = window.localStorage;
    LS.getItem(SKEY);
  } catch (e) {
    LS = null;
  }
  const store = JSON.parse((LS && LS.getItem(SKEY)) || "{}");
  const save = () => {
    try {
      LS && LS.setItem(SKEY, JSON.stringify(store));
    } catch (e) {
      /* private mode */
    }
  };
  const dayState = (d) =>
    (store[d] = store[d] || {
      stations: {},
      scores: {},
      notes: {},
      learned: {},
      speak: "",
      write: "",
      stuck: "",
    });

  // ---------- speech: TTS ----------
  const synth = window.speechSynthesis;
  let voice = null; // "you" (the candidate)
  let altVoice = null; // the interviewer
  function pickVoice() {
    if (!synth) return;
    const vs = synth.getVoices();
    voice =
      vs.find(
        (v) => /en-US/i.test(v.lang) && /Google|Samantha|Natural/i.test(v.name),
      ) ||
      vs.find((v) => /en-US/i.test(v.lang)) ||
      vs.find((v) => /^en/i.test(v.lang)) ||
      vs[0] ||
      null;
    const en = vs.filter((v) => /^en/i.test(v.lang));
    altVoice =
      en.find(
        (v) =>
          v !== voice &&
          /(male|Daniel|Alex|George|Guy|Fred|Rishi)/i.test(v.name),
      ) ||
      en.find((v) => v !== voice) ||
      voice;
  }
  if (synth) {
    pickVoice();
    synth.onvoiceschanged = pickVoice;
  }

  // Set true AFTER you generate web/audio/*.mp3 (see generate_audio.py) to use them.
  // Kept false by default so playback works instantly with the browser voice —
  // the MP3 path is async and, if used inside a click, some browsers block the
  // TTS fallback because the user-gesture context is lost.
  let USE_MP3 = true;

  // ---------- audio controller: one thing plays at a time, with play/pause + button state ----------
  const Player = {
    active: false, paused: false, mode: null, audioEl: null, btn: null, clips: null, i: 0, gapTimer: null,
    start(clips, btn) {
      // clicking the SAME button that's already playing → pause / resume
      if (this.active && this.btn === btn) { this.togglePause(); return; }
      this.stop(); // stop anything else first → no overlapping audio
      this.clips = clips.filter((c) => c && (c.text || c.fileId));
      this.i = 0; this.btn = btn || null; this.active = true; this.paused = false;
      this._mark("playing");
      this._next();
    },
    _next() {
      if (!this.active) return;
      if (this.i >= this.clips.length) { this._finish(); return; }
      const c = this.clips[this.i++];
      const advance = () => { this.gapTimer = setTimeout(() => this._next(), c.gap || 0); };
      if (USE_MP3 && c.fileId) {
        const a = new Audio("audio/" + c.fileId + ".mp3");
        a.playbackRate = c.rate || 1;
        this.audioEl = a; this.mode = "mp3";
        a.onended = () => { this.audioEl = null; advance(); };
        a.onerror = () => { this.audioEl = null; this._tts(c, advance); }; // fall back to voice
        a.play().catch(() => { this.audioEl = null; this._tts(c, advance); });
      } else {
        this._tts(c, advance);
      }
    },
    _tts(c, advance) {
      if (!synth) { toast("No speech voice on this device — generate MP3s for reliable audio."); advance(); return; }
      this.mode = "tts";
      const doSpeak = () => {
        try { synth.resume(); } catch (e) {}
        if (!voice) pickVoice();
        const u = new SpeechSynthesisUtterance(c.text || "");
        u.lang = "en-US"; u.rate = c.rate || 1;
        const v = c.useVoice || voice; if (v) u.voice = v;
        u.onend = () => advance();
        synth.speak(u);
      };
      if (synth.speaking || synth.pending) { synth.cancel(); setTimeout(doSpeak, 120); } else doSpeak();
    },
    togglePause() {
      if (!this.active) return;
      if (this.paused) {
        if (this.mode === "mp3" && this.audioEl) this.audioEl.play().catch(() => {});
        else { try { synth.resume(); } catch (e) {} }
        this.paused = false; this._mark("playing");
      } else {
        if (this.mode === "mp3" && this.audioEl) this.audioEl.pause();
        else { try { synth.pause(); } catch (e) {} }
        this.paused = true; this._mark("paused");
      }
    },
    stop() {
      this.active = false; this.paused = false;
      clearTimeout(this.gapTimer);
      try { if (synth) synth.cancel(); } catch (e) {}
      if (this.audioEl) { this.audioEl.onended = null; this.audioEl.onerror = null; try { this.audioEl.pause(); } catch (e) {} this.audioEl = null; }
      this._mark(false); this.btn = null; this.clips = null;
    },
    _finish() { this.active = false; this._mark(false); this.btn = null; },
    _mark(state) {
      document.querySelectorAll(".btn.playing").forEach((b) => { b.classList.remove("playing"); if (b._plabel != null) b.textContent = b._plabel; });
      if (this.btn && state) {
        if (this.btn._plabel == null) this.btn._plabel = this.btn.textContent;
        this.btn.classList.add("playing");
        this.btn.textContent = state === "paused" ? "▶ Resume" : "⏸ Pause";
      }
    },
  };
  // play(clip | [clips], buttonEl). Each clip: {fileId?, text, rate?, useVoice?, gap?}
  const play = (clips, btn) => Player.start(Array.isArray(clips) ? clips : [clips], btn);
  const stopAudio = () => Player.stop();

  // ---------- speech: STT ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function recognize(onResult, onDone) {
    if (!SR) {
      toast("Speech recognition needs Chrome/Edge.");
      onDone && onDone();
      return null;
    }
    const r = new SR();
    r.lang = "en-US";
    r.interimResults = true;
    r.continuous = true;
    let finalTxt = "";
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalTxt += t + " ";
        else interim += t;
      }
      onResult((finalTxt + interim).trim());
    };
    r.onend = () => onDone && onDone(finalTxt.trim());
    r.onerror = () => onDone && onDone(finalTxt.trim());
    r.start();
    return r;
  }

  // compare spoken/typed vs reference -> {pct, html}
  function compare(reference, said) {
    const ref = words(reference),
      got = words(said);
    const gotSet = {};
    got.forEach((w) => (gotSet[w] = (gotSet[w] || 0) + 1));
    let hit = 0;
    const html = ref
      .map((w) => {
        if (gotSet[w] > 0) {
          gotSet[w]--;
          hit++;
          return `<span class="ok">${w}</span>`;
        }
        return `<span class="miss">${w}</span>`;
      })
      .join(" ");
    const extras = Object.entries(gotSet)
      .filter(([, c]) => c > 0)
      .flatMap(([w, c]) => Array(c).fill(w));
    const pct = ref.length ? Math.round((hit / ref.length) * 100) : 0;
    return {
      pct,
      html:
        html +
        (extras.length
          ? ` <span class="extra">(+ ${extras.slice(0, 8).join(" ")}${extras.length > 8 ? "…" : ""})</span>`
          : ""),
    };
  }

  // ---------- data joins ----------
  const topicsById = Object.fromEntries(D.topics.map((t) => [t.id, t]));
  const shadowByTopic = {};
  D.shadowing_sets.forEach((s) => (shadowByTopic[s.topic_id] = s));
  function bankFor(type) {
    if (!type) return [];
    const key = norm(type);
    return D.sentence_bank
      .filter((b) => {
        const c = norm(b.category);
        return c === key || c.includes(key) || key.includes(c);
      })
      .slice(0, 8);
  }

  // ---------- state ----------
  let day = clampDay(store.currentDay || 1);
  let activeStation = 0;
  function clampDay(d) {
    return Math.max(1, Math.min(90, +d || 1));
  }
  function plan() {
    return D.daily_plan.find((p) => p.day === day) || D.daily_plan[0];
  }
  function ctx() {
    const p = plan();
    const topic = topicsById[p.topic_id] || {};
    const set = shadowByTopic[p.topic_id] || {};
    return { p, topic, set, bank: bankFor(topic.type || set.type) };
  }

  // ---------- stations ----------
  const STATIONS = [
    {
      id: "listening",
      icon: "👂",
      name: "Listening",
      mins: 10,
      render: renderListening,
    },
    {
      id: "echoing",
      icon: "🔁",
      name: "Echoing",
      mins: 8,
      render: renderEchoing,
    },
    {
      id: "shadowing",
      icon: "🗣️",
      name: "Shadowing",
      mins: 14,
      render: renderShadowing,
    },
    {
      id: "dictation",
      icon: "✍️",
      name: "Dictation",
      mins: 8,
      render: renderDictation,
    },
    {
      id: "reading",
      icon: "📖",
      name: "Reading",
      mins: 6,
      render: renderReading,
    },
    {
      id: "speakwrite",
      icon: "🎤",
      name: "Speaking + Writing",
      mins: 14,
      render: renderSpeakWrite,
    },
  ];

  function doneToggle(stationId) {
    const st = dayState(day);
    const on = !!st.stations[stationId];
    return el("label", { class: "chk done-toggle" }, [
      el("input", {
        type: "checkbox",
        ...(on ? { checked: "checked" } : {}),
        onchange: (e) => {
          st.stations[stationId] = e.target.checked;
          save();
          renderNav();
        },
      }),
      "Mark this station done",
    ]);
  }
  function speedControl(getRate, setRate) {
    const val = el("span", { text: getRate().toFixed(2) + "×" });
    return el("label", { class: "speed" }, [
      "Speed",
      el("input", {
        type: "range",
        min: "0.6",
        max: "1.2",
        step: "0.05",
        value: String(getRate()),
        oninput: (e) => {
          setRate(+e.target.value);
          val.textContent = (+e.target.value).toFixed(2) + "×";
        },
      }),
      val,
    ]);
  }

  function buildQuiz(c, st) {
    const qs = c.set.listening_questions || [];
    if (!qs.length) return null;
    st.quiz = st.quiz || {};
    const wrap = el("div");
    const rows = qs.map((item, qi) => {
      const opts = el("div");
      const feedback = el("span", { class: "pill", text: "" });
      item.options.forEach((opt, oi) => {
        const id = "q" + qi + "_" + oi;
        const radio = el("input", {
          type: "radio",
          name: "q_" + qi,
          id,
          value: String(oi),
          ...(st.quiz[qi] === oi ? { checked: "checked" } : {}),
          onchange: () => {
            st.quiz[qi] = oi;
            save();
          },
        });
        opts.appendChild(
          el("label", { class: "chk", for: id, style: "display:flex" }, [
            radio,
            " " + opt,
          ]),
        );
      });
      const row = el("div", { class: "sentence-item" }, [
        el("div", { class: "pat", html: `<b>${qi + 1}.</b> ${item.q}` }),
        opts,
        feedback,
      ]);
      row._grade = () => {
        const sel = st.quiz[qi];
        if (sel == null) {
          feedback.textContent = "no answer";
          feedback.className = "pill";
          return 0;
        }
        const ok = sel === item.answer;
        feedback.textContent = ok
          ? "✓ correct"
          : "✗ correct: " + item.options[item.answer];
        feedback.className = ok ? "pill ok" : "pill miss";
        feedback.style.textDecoration = "none";
        return ok ? 1 : 0;
      };
      return row;
    });
    rows.forEach((r) => wrap.appendChild(r));
    const scoreEl = el("span", { class: "matchline", text: "" });
    const checkBtn = el("button", {
      class: "btn",
      text: "✓ Check answers",
      onclick: () => {
        const correct = rows.reduce((n, r) => n + r._grade(), 0);
        const pct = Math.round((correct / rows.length) * 100);
        st.scores.listeningQuiz = pct;
        save();
        scoreEl.textContent = `Score: ${correct}/${rows.length}  (${pct}%)`;
      },
    });
    return el("div", {}, [
      el("label", {
        class: "field",
        text: "Listening comprehension — choose the best answer, then Check",
      }),
      wrap,
      el("div", { class: "row" }, [checkBtn, scoreEl]),
    ]);
  }

  function renderListening(c) {
    const st = dayState(day);
    let rate = 0.95;
    const script = el("div", {
      class: "script blurred",
      text: c.set.shadowing_script || c.topic.topic || "",
    });
    const revealBtn = el("button", {
      class: "btn secondary",
      text: "Reveal script",
      onclick: () => {
        script.classList.toggle("blurred");
        revealBtn.textContent = script.classList.contains("blurred")
          ? "Reveal script"
          : "Hide script";
      },
    });
    const notes = el("textarea", {
      rows: "3",
      placeholder: "In your own words: what is the main idea? (self-check)",
      text: st.notes.listening || "",
    });
    notes.addEventListener("input", () => {
      st.notes.listening = notes.value;
      save();
    });
    return [
      el("p", {
        class: "why",
        text: "Set the scene above, then play the interview: hear the interviewer's question, then the answer. Script stays hidden — answer the questions, then reveal to check.",
      }),
      el("div", { class: "row" }, [
        el("button", {
          class: "btn",
          text: "▶ Play as interview",
          onclick: (e) =>
            play(
              [
                { fileId: c.set.set_id + "_q", text: c.set.interviewer_line, rate: 1, useVoice: altVoice, gap: 350 },
                { fileId: c.set.set_id, text: script.textContent, rate: rate, useVoice: voice },
              ],
              e.currentTarget,
            ),
        }),
        el("button", {
          class: "btn secondary",
          text: "▶ Answer only",
          onclick: (e) =>
            play({ fileId: c.set.set_id, text: script.textContent, rate: rate, useVoice: voice }, e.currentTarget),
        }),
        el("button", {
          class: "btn secondary",
          text: "⏹ Stop",
          onclick: stopAudio,
        }),
        speedControl(
          () => rate,
          (r) => (rate = r),
        ),
        revealBtn,
      ]),
      buildQuiz(c, st),
      el("div", { style: "height:12px" }),
      script,
      el("p", {
        class: "hint",
        text:
          "Key words to listen for: " +
          ((c.topic.keywords || []).join(", ") || "—"),
      }),
      el("label", { class: "field", text: "Comprehension note" }),
      notes,
      doneToggle("listening"),
    ];
  }

  function renderEchoing(c) {
    const sents = splitSentences(c.set.shadowing_script || c.topic.topic || "");
    let rate = 0.9;
    const list = el("div");
    sents.forEach((s, i) => {
      list.appendChild(
        el("div", { class: "dictation-line" }, [
          el("span", { class: "idx", text: i + 1 + "." }),
          el("div", { class: "grow" }, [
            el("div", { class: "transcript", text: s }),
            el("div", { class: "row" }, [
              el("button", {
                class: "btn secondary",
                text: "🔊 Hear",
                onclick: (e) =>
                  play({ text: s, rate: rate, useVoice: voice }, e.currentTarget),
              }),
              el("span", { class: "hint", text: "→ pause → repeat out loud" }),
            ]),
          ]),
        ]),
      );
    });
    return [
      el("p", {
        class: "why",
        text: "Hear one sentence, pause, and repeat it out loud immediately. Short loops build muscle memory.",
      }),
      el("div", { class: "row" }, [
        speedControl(
          () => rate,
          (r) => (rate = r),
        ),
      ]),
      list,
      doneToggle("echoing"),
    ];
  }

  function renderShadowing(c) {
    const st = dayState(day);
    let rate = 0.9;
    let rec = null;
    const script = el("div", { class: "script" });
    const chunks = (c.set.chunking || "").split("\n").filter(Boolean);
    script.textContent = c.set.shadowing_script || c.topic.topic || "";
    const trans = el("div", {
      class: "transcript empty",
      text: "Your shadow attempt will appear here…",
    });
    const bar = el("div", { class: "scorebar" }, [
      el("i", { style: "width:0%" }),
    ]);
    const matchLine = el("div", { class: "matchline", text: "" });
    const recBtn = el("button", { class: "btn rec", text: "● Record shadow" });
    recBtn.addEventListener("click", () => {
      if (rec) {
        rec.stop();
        rec = null;
        recBtn.classList.remove("recording");
        recBtn.textContent = "● Record shadow";
        return;
      }
      trans.classList.remove("empty");
      trans.textContent = "Listening…";
      recBtn.classList.add("recording");
      recBtn.textContent = "■ Stop";
      rec = recognize(
        (t) => (trans.textContent = t || "…"),
        (final) => {
          rec = null;
          recBtn.classList.remove("recording");
          recBtn.textContent = "● Record shadow";
          const r = compare(script.textContent, final);
          trans.innerHTML = r.html || "(nothing captured)";
          bar.firstChild.style.width = r.pct + "%";
          matchLine.textContent = `Word match: ${r.pct}%  (green = matched, red = missed, yellow = extra)`;
          st.scores.shadowMatch = r.pct;
          save();
        },
      );
    });
    return [
      el("p", {
        class: "why",
        text: "Play and speak on top of the audio at the same time. Match the rhythm; don't wait for it to finish.",
      }),
      el("div", { class: "row" }, [
        el("button", {
          class: "btn",
          text: "▶ Play",
          onclick: (e) =>
            play({ fileId: c.set.set_id, text: script.textContent, rate: rate, useVoice: voice }, e.currentTarget),
        }),
        el("button", {
          class: "btn secondary",
          text: "⏹ Stop",
          onclick: stopAudio,
        }),
        speedControl(
          () => rate,
          (r) => (rate = r),
        ),
        recBtn,
      ]),
      el("div", { style: "height:12px" }),
      script,
      chunks.length
        ? el("p", {
            class: "hint",
            html: "<b>Chunking:</b> " + chunks.join(" · "),
          })
        : null,
      c.set.pronunciation_rhythm_focus
        ? el("p", {
            class: "hint",
            html: "<b>Rhythm focus:</b> " + c.set.pronunciation_rhythm_focus,
          })
        : null,
      c.set.pass_criteria
        ? el("p", {
            class: "hint",
            html: "<b>Pass:</b> " + c.set.pass_criteria,
          })
        : null,
      el("label", { class: "field", text: "Your attempt (speech-to-text)" }),
      trans,
      bar,
      matchLine,
      doneToggle("shadowing"),
    ];
  }

  function renderDictation(c) {
    const st = dayState(day);
    const sents = splitSentences(c.set.shadowing_script || c.topic.topic || "");
    let rate = 0.85;
    const wrap = el("div");
    sents.forEach((s, i) => {
      const input = el("input", {
        type: "text",
        placeholder: "Type what you hear…",
      });
      const result = el("div", { class: "matchline" });
      const bar = el("div", { class: "scorebar" }, [
        el("i", { style: "width:0%" }),
      ]);
      const check = () => {
        const r = compare(s, input.value);
        result.innerHTML = r.html;
        bar.firstChild.style.width = r.pct + "%";
      };
      wrap.appendChild(
        el("div", { class: "dictation-line" }, [
          el("span", { class: "idx", text: i + 1 + "." }),
          el("div", { class: "grow" }, [
            el("div", { class: "row" }, [
              el("button", {
                class: "btn secondary",
                text: "🔊 Play",
                onclick: (e) =>
                  play({ text: s, rate: rate, useVoice: voice }, e.currentTarget),
              }),
              el("button", {
                class: "btn secondary",
                text: "✓ Check",
                onclick: check,
              }),
            ]),
            input,
            bar,
            result,
          ]),
        ]),
      );
    });
    return [
      el("p", {
        class: "why",
        text: "Play a sentence, type exactly what you hear, then Check. Trains listening precision + spelling.",
      }),
      el("div", { class: "row" }, [
        speedControl(
          () => rate,
          (r) => (rate = r),
        ),
      ]),
      wrap,
      doneToggle("dictation"),
    ];
  }

  function renderReading(c) {
    const st = dayState(day);
    let rec = null;
    const items = c.bank.length ? c.bank : [];
    const bankEl = el("div");
    items.forEach((b, i) => {
      const key = "sb_" + i;
      const learned = !!st.learned[b.pattern];
      const trans = el("div", {
        class: "transcript empty",
        text: "Read aloud → transcript here",
      });
      let r = null;
      const readBtn = el("button", { class: "btn rec", text: "🎤 Read aloud" });
      readBtn.addEventListener("click", () => {
        if (r) {
          r.stop();
          r = null;
          readBtn.classList.remove("recording");
          readBtn.textContent = "🎤 Read aloud";
          return;
        }
        trans.classList.remove("empty");
        trans.textContent = "Listening…";
        readBtn.classList.add("recording");
        readBtn.textContent = "■ Stop";
        r = recognize(
          (t) => (trans.textContent = t || "…"),
          (final) => {
            r = null;
            readBtn.classList.remove("recording");
            readBtn.textContent = "🎤 Read aloud";
            const cmp = compare(b.personalized_example || b.pattern, final);
            trans.innerHTML =
              cmp.html + ` <span class="pill">${cmp.pct}%</span>`;
          },
        );
      });
      bankEl.appendChild(
        el("div", { class: "sentence-item" }, [
          el("div", { class: "pat", text: b.pattern }),
          b.personalized_example
            ? el("div", {
                class: "simple",
                text: "→ " + b.personalized_example,
              })
            : null,
          b.simpler_version
            ? el("div", {
                class: "simple",
                text: "simpler: " + b.simpler_version,
              })
            : null,
          b.vietnamese_meaning
            ? el("div", { class: "vn", text: b.vietnamese_meaning })
            : null,
          el("div", { class: "tools" }, [
            el("button", {
              class: "btn secondary",
              text: "🔊 Hear",
              onclick: (e) =>
                play({ text: b.personalized_example || b.pattern, rate: 0.95, useVoice: voice }, e.currentTarget),
            }),
            readBtn,
            el("label", { class: "chk" }, [
              el("input", {
                type: "checkbox",
                ...(learned ? { checked: "checked" } : {}),
                onchange: (e) => {
                  st.learned[b.pattern] = e.target.checked;
                  save();
                },
              }),
              "learned",
            ]),
          ]),
          trans,
        ]),
      );
    });
    return [
      el("p", {
        class: "why",
        text: "Read the target script and your sentence bank aloud. Tick the ones you've internalised.",
      }),
      el("div", {
        class: "script",
        text: c.set.shadowing_script || c.topic.topic || "",
      }),
      el("div", { class: "row" }, [
        el("button", {
          class: "btn",
          text: "🔊 Hear model",
          onclick: (e) =>
            play(
              { fileId: c.set.set_id, text: c.set.shadowing_script || c.topic.topic, rate: 0.95, useVoice: voice },
              e.currentTarget,
            ),
        }),
      ]),
      el("label", { class: "field", text: "Sentence bank for this topic" }),
      items.length
        ? bankEl
        : el("p", {
            class: "hint",
            text: "No sentence-bank entries mapped to this topic.",
          }),
      doneToggle("reading"),
    ];
  }

  function renderSpeakWrite(c) {
    const st = dayState(day);
    let rec = null;
    const prompt =
      c.set.free_speaking_prompt ||
      "Answer this interview question in 60 seconds: " +
        (c.topic.topic || c.p.main_topic);
    const trans = el("div", {
      class: "transcript " + (st.speak ? "" : "empty"),
      text: st.speak || "Your spoken answer appears here…",
    });
    const recBtn = el("button", { class: "btn rec", text: "● Record answer" });
    recBtn.addEventListener("click", () => {
      if (rec) {
        rec.stop();
        rec = null;
        recBtn.classList.remove("recording");
        recBtn.textContent = "● Record answer";
        return;
      }
      trans.classList.remove("empty");
      trans.textContent = "Listening…";
      recBtn.classList.add("recording");
      recBtn.textContent = "■ Stop";
      rec = recognize(
        (t) => (trans.textContent = t),
        (final) => {
          rec = null;
          recBtn.classList.remove("recording");
          recBtn.textContent = "● Record answer";
          st.speak = final;
          trans.textContent = final || "(nothing captured)";
          save();
        },
      );
    });
    const writeBox = el("textarea", {
      rows: "5",
      placeholder: "Write your STAR answer here…",
      text: st.write || "",
    });
    writeBox.addEventListener("input", () => {
      st.write = writeBox.value;
      save();
    });
    const stuck = el("textarea", {
      rows: "2",
      placeholder: "Words/ideas you got stuck on…",
      text: st.stuck || "",
    });
    stuck.addEventListener("input", () => {
      st.stuck = stuck.value;
      save();
    });

    // self-scores per rubric
    const rubric = [
      "Fluency",
      "Pronunciation",
      "Grammar/Vocabulary",
      "Interview Readiness",
    ];
    const sliderGrid = el("div", { class: "slider-grid" });
    rubric.forEach((name) => {
      const cur = st.scores[name] != null ? st.scores[name] : 6;
      const valEl = el("span", { class: "sval", text: cur.toFixed(1) });
      sliderGrid.appendChild(
        el("div", { class: "slider-row" }, [
          el("span", { class: "sname", text: name }),
          el("input", {
            type: "range",
            min: "4",
            max: "9",
            step: "0.5",
            value: String(cur),
            oninput: (e) => {
              st.scores[name] = +e.target.value;
              valEl.textContent = (+e.target.value).toFixed(1);
              save();
            },
          }),
          valEl,
        ]),
      );
    });

    const followUps = c.set.follow_up_questions || [];
    const followEl = el("div");
    followUps.forEach((q, i) => {
      followEl.appendChild(
        el("div", { class: "sentence-item" }, [
          el("div", { class: "pat", html: `<b>Q${i + 1}.</b> ${q}` }),
          el("div", { class: "tools" }, [
            el("button", {
              class: "btn secondary",
              text: "🔊 Hear",
              onclick: (e) =>
                play({ text: q, rate: 0.95, useVoice: voice }, e.currentTarget),
            }),
          ]),
        ]),
      );
    });

    const exportBox = el("textarea", { rows: "9", readonly: "readonly" });
    const buildExport = () => {
      const kw = (c.topic.keywords || []).join(", ");
      const avg = rubric.map((n) => st.scores[n]).filter((v) => v != null);
      const avgTxt = avg.length
        ? (avg.reduce((a, b) => a + b, 0) / avg.length).toFixed(1)
        : "n/a";
      exportBox.value = `You are my interviewer AND English speaking coach for a backend engineer job interview. First play the scenario below in character, then evaluate ONLY my spoken/communication skills (fluency, pronunciation, grammar/vocabulary, interview readiness) using the rubric as reference, and run a short mock interview with the follow-up questions.

SCENARIO: ${c.set.scenario || "General interview."}
Day ${day} — Topic: ${c.topic.topic || c.p.main_topic}
Target score: ${c.topic.target || "—"} | Structure: ${c.topic.structure || "—"}
Keywords I should use: ${kw || "—"}
Interviewer's question: ${c.set.interviewer_line || prompt}

MY SPOKEN ANSWER (auto-transcribed, may have STT errors):
${st.speak || "(record your answer in the app first)"}

MY WRITTEN STAR ANSWER:
${st.write || "(optional)"}

FOLLOW-UP QUESTIONS to ask me one by one:
${followUps.length ? followUps.map((q, i) => `${i + 1}. ${q}`).join("\n") : "(none)"}

MY SELF-SCORES: ${rubric.map((n) => n + "=" + (st.scores[n] != null ? st.scores[n] : "?")).join(", ")} (self avg ${avgTxt})
I got stuck on: ${st.stuck || "—"}

Please: 1) score each rubric item with one concrete fix, 2) rewrite my weakest 2 sentences, 3) then ask the follow-up questions one at a time as a mock interview by voice.`;
    };
    buildExport();
    return [
      el("p", {
        class: "why",
        text: "Speak your answer (auto-transcribed), write the STAR version, practise the follow-ups, self-score, then export a ready prompt for Claude/ChatGPT voice.",
      }),
      el("div", { class: "script", text: prompt }),
      el("div", { class: "row" }, [
        recBtn,
        el("button", {
          class: "btn secondary",
          text: "Clear",
          onclick: () => {
            st.speak = "";
            trans.textContent = "Your spoken answer appears here…";
            trans.classList.add("empty");
            save();
          },
        }),
      ]),
      el("label", { class: "field", text: "Spoken answer (STT)" }),
      trans,
      followUps.length
        ? el("label", {
            class: "field",
            text: "Follow-up questions — try answering these out loud too",
          })
        : null,
      followUps.length ? followEl : null,
      el("label", { class: "field", text: "Written STAR answer" }),
      writeBox,
      el("label", {
        class: "field",
        text: "Self-scores (main metric is the coach's, this is just your gut check)",
      }),
      sliderGrid,
      el("label", { class: "field", text: "Stuck points" }),
      stuck,
      el("label", {
        class: "field",
        text: "📋 Export prompt for your voice coach",
      }),
      exportBox,
      el("div", { class: "row" }, [
        el("button", {
          class: "btn",
          text: "Rebuild + Copy",
          onclick: () => {
            buildExport();
            navigator.clipboard
              ?.writeText(exportBox.value)
              .then(() => toast("Copied — paste into Claude/ChatGPT voice"));
          },
        }),
      ]),
      doneToggle("speakwrite"),
    ];
  }

  // ---------- shell rendering ----------
  function renderHead() {
    const { p, topic } = ctx();
    $("#phaseTag").textContent = p.phase || "";
    $("#topicTitle").textContent = topic.topic || p.main_topic || "Day " + day;
    const review =
      p.review && p.review.length ? " · Review: " + p.review.join(", ") : "";
    $("#lessonMeta").textContent =
      `${p.method || ""} · ${topic.type || ""}${review}`;
    $("#targetScore").textContent = topic.target || "—";
    $("#daySelect").value = String(day);
  }
  function renderNav() {
    const nav = $("#stationNav");
    nav.innerHTML = "";
    const st = dayState(day);
    STATIONS.forEach((s, i) => {
      const b = el(
        "button",
        {
          class:
            (i === activeStation ? "active " : "") +
            (st.stations[s.id] ? "done" : ""),
          onclick: () => {
            activeStation = i;
            renderStation();
            renderNav();
          },
        },
        [
          el("span", { class: "dot" }),
          s.icon + " " + s.name,
          el("span", { class: "pill", text: s.mins + "m" }),
        ],
      );
      nav.appendChild(b);
    });
  }
  function renderStation() {
    const c = ctx();
    const s = STATIONS[activeStation];
    const main = $("#stations");
    main.innerHTML = "";
    stopAudio();
    const card = el("div", { class: "card" }, [
      el("h3", {}, [
        s.icon + " " + s.name,
        el("span", { class: "pill", text: "~" + s.mins + " min" }),
      ]),
    ]);
    if (c.set.scenario) {
      card.appendChild(
        el("div", { class: "scenario" }, [
          el("span", { class: "sc-tag", text: "🎬 Scenario" }),
          el("span", { class: "sc-text", text: c.set.scenario }),
          c.set.interviewer_line
            ? el("div", { class: "sc-q" }, [
                el("span", {
                  text: "🗣️ Interviewer: “" + c.set.interviewer_line + "”",
                }),
                el("button", {
                  class: "btn secondary",
                  text: "🔊",
                  title: "Hear the interviewer",
                  onclick: (e) =>
                    play(
                      { fileId: c.set.set_id + "_q", text: c.set.interviewer_line, rate: 1, useVoice: altVoice },
                      e.currentTarget,
                    ),
                }),
              ])
            : null,
        ]),
      );
    }
    s.render(c).forEach((node) => node && card.appendChild(node));
    main.appendChild(card);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function renderAll() {
    renderHead();
    renderNav();
    renderStation();
  }

  function goDay(d) {
    day = clampDay(d);
    activeStation = 0;
    store.currentDay = day;
    save();
    renderAll();
  }

  // ---------- init ----------
  function init() {
    const sel = $("#daySelect");
    D.daily_plan.forEach((p) =>
      sel.appendChild(
        el("option", {
          value: String(p.day),
          text: `${p.day} — ${(topicsById[p.topic_id] || {}).topic || p.main_topic}`,
        }),
      ),
    );
    sel.addEventListener("change", (e) => goDay(+e.target.value));
    $("#prevDay").addEventListener("click", () => goDay(day - 1));
    $("#nextDay").addEventListener("click", () => goDay(day + 1));
    const notes = [];
    if (!SR)
      notes.push(
        "Speech recognition unavailable (use Chrome/Edge for recording).",
      );
    if (!synth) notes.push("Speech synthesis unavailable.");
    $("#supportNote").textContent = notes.length
      ? "⚠ " + notes.join(" ")
      : "Tip: Chrome/Edge give the best speech support. Progress is saved in this browser.";
    renderAll();
  }
  init();
})();
