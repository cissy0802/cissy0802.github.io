/* BigCat Learning Hub — i18n + TTS
 *
 * THREE MODES detected at load:
 *
 * 1. SPLIT mode (new, default for clean pages):
 *    - Page has <html lang="zh-CN"> or <html lang="en"> AND no data-zh attrs
 *    - Each language lives in its own file: foo.html (zh) / foo.en.html (en)
 *    - Lang toggle = navigate to the other file
 *    - TTS reads current page lang only
 *
 * 2. FULL mode (legacy embedded):
 *    - <html data-i18n-mode="full"> + data-zh / data-en attributes everywhere
 *    - Lang toggle = swap innerHTML in place
 *
 * 3. LEGACY mode (oldest pages):
 *    - Bilingual sections labeled by class/text, show/hide by language
 */
(function () {
  'use strict';

  const LANG_KEY = 'mmd-lang';
  const RATE_KEY = 'mmd-tts-rate';
  const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

  // ---------- Where baked MP3s live ----------------------------------------
  // Most repos still ship audio/ inside the repo (relative URL). Migrated repos
  // serve it from R2 through the bigcat-audio Worker instead, to keep the repo
  // and its GitHub Pages site under the 1GB limit.
  //
  // THREE PLACES MUST AGREE — update all of them when migrating a repo:
  //   i18n-tts.js  (here)      playback
  //   offline.js   R2_AUDIO_*  offline download
  //   sw.js        AUDIO_ORIGIN  lets the cross-origin MP3 reach the cache
  const R2_AUDIO_ORIGIN = 'https://bigcat-audio.cissychen.workers.dev';
  const R2_AUDIO_REPOS = { 'personal-finance': 1 };

  // First path segment = repo slug ("/personal-finance/foo.html" → "personal-finance").
  function repoSlugOf(pathname) {
    const m = /^\/([^/]+)\//.exec(pathname);
    return m ? m[1] : '';
  }

  function audioUrl(lang, hash) {
    const repo = repoSlugOf(location.pathname);
    if (R2_AUDIO_REPOS[repo]) {
      return R2_AUDIO_ORIGIN + '/' + repo + '/' + lang + '/' + hash + '.mp3';
    }
    return 'audio/' + lang + '/' + hash + '.mp3';
  }

  const fullMode = document.documentElement.getAttribute('data-i18n-mode') === 'full';
  const hasDataZh = document.querySelector('[data-zh][data-en]') !== null;
  const splitMode = !fullMode && !hasDataZh;

  // In split mode, page's own lang attribute is authoritative; localStorage is irrelevant.
  let currentLang;
  if (splitMode) {
    currentLang = (document.documentElement.lang || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh';
  } else {
    currentLang = localStorage.getItem(LANG_KEY) || 'zh';
  }

  // ---------- Split-mode lang toggle: navigate to other file ----------
  function otherLangUrl() {
    const p = window.location.pathname;
    // index.html -> index.en.html and vice versa
    // foo-day9.html -> foo-day9.en.html
    // foo-day9.en.html -> foo-day9.html
    if (/\.en\.html$/.test(p)) return p.replace(/\.en\.html$/, '.html');
    if (/\.html$/.test(p))     return p.replace(/\.html$/, '.en.html');
    // Bare dir like /repo/ -> /repo/index.en.html etc.
    if (p.endsWith('/')) return p + (currentLang === 'zh' ? 'index.en.html' : 'index.html');
    return p;
  }

  // ---------- Language ----------
  function applyLang(lang) {
    currentLang = lang;
    localStorage.setItem(LANG_KEY, lang);
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';

    if (fullMode) {
      document.querySelectorAll('[data-zh][data-en]').forEach((el) => {
        const html = el.getAttribute('data-' + lang);
        if (html != null && el.innerHTML !== html) el.innerHTML = html;
      });
      // Hide sections not wanted in this language
      document.querySelectorAll('[data-hide-in]').forEach((el) => {
        el.style.display = el.getAttribute('data-hide-in') === lang ? 'none' : '';
      });
    } else {
      // Legacy fallback: toggle bilingual sections by their label text
      const isEn = lang === 'en';
      document.querySelectorAll('.section').forEach((section) => {
        const label = section.querySelector('.section-label');
        if (!label) return;
        const t = label.textContent;
        if (/中文/.test(t)) section.style.display = isEn ? 'none' : '';
        else if (/English\s+Summary/i.test(t)) section.style.display = isEn ? '' : '';
      });
      document.querySelectorAll('.prompt-item').forEach((item) => {
        const lab = item.querySelector('.lang');
        if (!lab) return;
        const t = lab.textContent;
        if (/中文/.test(t)) item.style.display = isEn ? 'none' : '';
        else if (/English/i.test(t)) item.style.display = '';
      });
    }

    updateLangButton();
    if (tts.playing) tts.stop();
    rebuildSegments();
  }

  // ---------- TTS ----------
  const tts = {
    segments: [],
    idx: -1,
    playing: false,
    paused: false,
    rate: parseFloat(localStorage.getItem(RATE_KEY)) || 1,
    utter: null,
    audio: null,

    play() {
      if (this.paused) {
        if (this.audio) this.audio.play().catch(() => {});
        else if ('speechSynthesis' in window) speechSynthesis.resume();
        this.paused = false;
        updatePlayButton();
        return;
      }
      if (!this.segments.length) rebuildSegments();
      if (!this.segments.length) return;
      if (this.idx < 0 || this.idx >= this.segments.length) this.idx = 0;
      this.playing = true;
      this.speakCurrent();
      updatePlayButton();
    },

    speakCurrent() {
      if (this.idx >= this.segments.length) {
        this.stop();
        return;
      }
      const seg = this.segments[this.idx];
      document.querySelectorAll('.tts-active, .tts-active-ring').forEach((el) => {
        el.classList.remove('tts-active', 'tts-active-ring');
      });
      // Gradient-clipped text (background-clip:text + transparent fill) is
      // painted BY its background, so our highlight background would erase
      // the glyphs. Those get a ring-only variant.
      seg.classList.add(usesTextClip(seg) ? 'tts-active-ring' : 'tts-active');
      seg.scrollIntoView({ behavior: 'smooth', block: 'start' });
      updateProgress();

      // Tear down any in-flight audio/utterance from the previous segment
      this._cancelPlayback();

      const hash = splitMode
        ? seg.getAttribute('data-tts')
        : seg.getAttribute('data-tts-' + currentLang);
      if (hash) {
        const url = audioUrl(currentLang, hash);
        const audio = new Audio(url);
        audio.playbackRate = this.rate;
        audio.preload = 'auto';
        const myToken = ++this._token;
        const isStale = () => myToken !== this._token;
        audio.onended = () => {
          if (isStale() || !this.playing || audio._priming) return;
          this.idx++;
          this.speakCurrent();
        };
        audio.onerror = () => {
          if (isStale()) return;
          console.warn(`[mmd-tts] ${url} unavailable, falling back to Web Speech`);
          this.speakWebSpeech(seg, isStale);
        };
        audio.onloadedmetadata = () => {
          if (isStale()) return;
          setSeekEnabled(true);
          if (isFinite(audio.duration) && audio.duration > 0) {
            updateSeek(0, audio.duration);
          } else {
            // Azure mp3s often ship without a duration in the header, so the
            // browser reports Infinity/NaN until the file is fully scanned.
            // Probe for the real duration so seek math has something to work with.
            primeDuration(audio, isStale);
          }
        };
        audio.ondurationchange = () => {
          if (isStale() || audio._priming) return;
          if (isFinite(audio.duration) && audio.duration > 0) {
            setSeekEnabled(true);
            if (!isScrubbing) updateSeek(audio.currentTime, audio.duration);
          }
        };
        audio.ontimeupdate = () => {
          if (isStale() || isScrubbing || audio._priming) return;
          updateSeek(audio.currentTime, durationOf(audio));
        };
        this.audio = audio;
        audio.play().catch((e) => {
          if (isStale()) return;
          console.warn(`[mmd-tts] audio.play() rejected (${e?.message || e}); falling back`);
          this.speakWebSpeech(seg, isStale);
        });
        return;
      }
      // No baked audio for this segment → Web Speech (no seek support)
      setSeekEnabled(false);
      updateSeek(0, 0);
      const myToken = ++this._token;
      this.speakWebSpeech(seg, () => myToken !== this._token);
    },

    seekTo(fraction) {
      const dur = durationOf(this.audio);
      if (!this.audio || !dur) return;
      const t = Math.max(0, Math.min(dur, fraction * dur));
      if (!isFinite(t)) return;
      try { this.audio.currentTime = t; } catch (e) {}
      updateSeek(t, dur);
    },

    skip(deltaSeconds) {
      const dur = durationOf(this.audio);
      if (!this.audio || !dur) return;
      const t = Math.max(0, Math.min(dur, this.audio.currentTime + deltaSeconds));
      if (!isFinite(t)) return;
      try { this.audio.currentTime = t; } catch (e) {}
      updateSeek(t, dur);
    },

    _chunker: null,

    speakWebSpeech(seg, isStale) {
      if (!('speechSynthesis' in window)) return;
      const text = seg.textContent.trim();
      if (!text) {
        if (isStale && isStale()) return;
        this.idx++;
        this.speakCurrent();
        return;
      }
      // iOS Safari silently truncates utterances past ~200 chars. Chunk long
      // text at sentence boundaries so every part is read on all platforms.
      const chunks = chunkForSpeech(text, 160);
      const lang = currentLang === 'zh' ? 'zh-CN' : 'en-US';
      const voice = pickVoice(lang);
      const rate = this.rate;
      const playing = () => (isStale ? !isStale() : true) && this.playing;
      // iOS Safari's u.onend is famously unreliable — it sometimes never
      // fires after a chunk completes. Poll speechSynthesis.speaking as a
      // fallback so we always advance.
      let pollTimer = null;
      const clearPoll = () => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };
      if (this._chunker) this._chunker.cancelled = true;
      const chunker = this._chunker = { cancelled: false };
      const speakChunk = (i) => {
        clearPoll();
        if (chunker.cancelled || !playing()) return;
        if (i >= chunks.length) {
          this.idx++;
          this.speakCurrent();
          return;
        }
        const u = new SpeechSynthesisUtterance(chunks[i]);
        u.lang = lang;
        u.rate = rate;
        if (voice) u.voice = voice;
        let advanced = false;
        const advance = () => {
          if (advanced) return;
          advanced = true;
          clearPoll();
          if (chunker.cancelled || !playing()) return;
          speakChunk(i + 1);
        };
        u.onend = advance;
        u.onerror = (e) => {
          if (!playing()) return;
          if (e.error && e.error !== 'interrupted' && e.error !== 'canceled') advance();
        };
        this.utter = u;
        speechSynthesis.speak(u);
        // Fallback poll — if the engine stops speaking without firing onend
        // (iOS bug), treat that as end after 400ms of continuous silence.
        let stopStreak = 0;
        pollTimer = setInterval(() => {
          if (advanced) { clearPoll(); return; }
          if (speechSynthesis.speaking || speechSynthesis.pending) {
            stopStreak = 0;
          } else {
            stopStreak += 200;
            if (stopStreak >= 400) advance();
          }
        }, 200);
      };
      speechSynthesis.cancel();
      speakChunk(0);
    },

    _token: 0,

    _cancelPlayback() {
      // Invalidate any pending callbacks from the previous segment
      this._token++;
      if (this.audio) {
        try { this.audio.pause(); } catch (e) {}
        this.audio.removeAttribute('src');
        this.audio.load?.();
        this.audio = null;
      }
      if ('speechSynthesis' in window) speechSynthesis.cancel();
    },

    pause() {
      if (!this.playing || this.paused) return;
      if (this.audio) {
        this.audio.pause();
      } else if ('speechSynthesis' in window) {
        speechSynthesis.pause();
      }
      this.paused = true;
      updatePlayButton();
    },

    stop() {
      this.playing = false;
      this.paused = false;
      this.idx = -1;
      this._cancelPlayback();
      document.querySelectorAll('.tts-active, .tts-active-ring').forEach((el) => {
        el.classList.remove('tts-active', 'tts-active-ring');
      });
      updatePlayButton();
      updateProgress();
      setSeekEnabled(false);
      updateSeek(0, 0);
    },

    next() {
      if (!this.segments.length) return;
      this.idx = Math.min(this.idx + 1, this.segments.length - 1);
      this.playing = true;
      this.paused = false;
      this.speakCurrent();
      updatePlayButton();
    },

    prev() {
      if (!this.segments.length) return;
      this.idx = Math.max(0, this.idx - 1);
      this.playing = true;
      this.paused = false;
      this.speakCurrent();
      updatePlayButton();
    },

    setRate(r) {
      this.rate = r;
      localStorage.setItem(RATE_KEY, String(r));
      updateRateLabel();
      // Audio supports live rate changes; Web Speech needs a restart
      if (this.audio && !this.audio.paused) {
        this.audio.playbackRate = r;
      } else if (this.playing && !this.paused && !this.audio) {
        this.speakCurrent();
      }
    },
  };

  // Chunk text at natural boundaries (sentence, then clause) so no piece
  // exceeds `max` chars. Works around iOS Safari's ~200-char utterance
  // truncation and generally reduces stalls on other engines too.
  function chunkForSpeech(text, max) {
    const out = [];
    // Split on sentence enders first (keep punctuation with the previous piece)
    const sentences = text.split(/(?<=[。！？!?\.])\s*/).filter(Boolean);
    let buf = '';
    const flush = () => { if (buf) { out.push(buf); buf = ''; } };
    for (const s of sentences) {
      if (s.length <= max) {
        if ((buf + s).length <= max) buf += s;
        else { flush(); buf = s; }
      } else {
        flush();
        // Sentence too long — split further on commas / semi-colons
        const parts = s.split(/(?<=[，,;；：:])\s*/).filter(Boolean);
        let sub = '';
        for (const p of parts) {
          if (p.length > max) {
            // Hard-cap: slice at max
            if (sub) { out.push(sub); sub = ''; }
            for (let i = 0; i < p.length; i += max) out.push(p.slice(i, i + max));
          } else if ((sub + p).length <= max) {
            sub += p;
          } else {
            out.push(sub);
            sub = p;
          }
        }
        if (sub) out.push(sub);
      }
    }
    flush();
    return out;
  }

  // True when an element's glyphs are painted by its own background
  // (gradient headings: background-clip:text + transparent text fill).
  // Overriding `background` on these makes the text vanish.
  function usesTextClip(el) {
    try {
      const cs = getComputedStyle(el);
      const clip = cs.webkitBackgroundClip || cs.backgroundClip;
      if (clip && clip.includes('text')) return true;
      const fill = cs.webkitTextFillColor;
      return !!fill && (fill === 'transparent' || fill === 'rgba(0, 0, 0, 0)');
    } catch (e) {
      return false;
    }
  }

  function pickVoice(lang) {
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return null;
    const prefix = lang.slice(0, 2).toLowerCase();
    const preferred = {
      zh: ['Tingting', 'Sinji', 'Meijia', 'Mei-Jia', 'Microsoft Xiaoxiao', 'Google 普通话', 'Yaoyao'],
      en: ['Samantha', 'Karen', 'Daniel', 'Microsoft Aria', 'Google US English', 'Alex'],
    }[prefix] || [];
    for (const name of preferred) {
      const v = voices.find((x) => x.name && x.name.includes(name));
      if (v) return v;
    }
    return voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(prefix)) || null;
  }

  function rebuildSegments() {
    const visible = (el) => {
      if (el.closest('.mmd-controls')) return false;
      if (el.closest('nav')) return false;
      if (!el.textContent.trim()) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      // getComputedStyle only reports the element's own style, so a heading
      // inside a display:none ancestor still says display:block. Sites with
      // toggled panels (cs-papers' 科普版/精读版) would otherwise offer both
      // copies at once. getClientRects() is empty for anything not rendered.
      if (!el.getClientRects().length) return false;
      return true;
    };
    // Prefer per-group baked audio. Split-mode pages use simple `data-tts`
    // (one lang per page); legacy/embedded pages use `data-tts-zh` / `data-tts-en`.
    const ttsAttr = splitMode ? 'data-tts' : `data-tts-${currentLang}`;
    const tagged = document.querySelectorAll(`[${ttsAttr}]`);
    if (tagged.length > 0) {
      tts.segments = Array.from(tagged).filter(visible);
    } else {
      // Fallback for un-baked pages: read headings + paragraphs + leaf content
      // divs (summary/details, per-card section wrappers, prompt boxes, etc.).
      // A "leaf" div has no block-level children — its text is its own content
      // rather than aggregated from inner blocks.
      const BLOCK_TAGS = new Set(['DIV','P','H1','H2','H3','H4','H5','H6','UL','OL','LI','SECTION','ARTICLE','TABLE','TR','TD','TH','PRE','BLOCKQUOTE']);
      const isLeafDiv = (el) => {
        for (const c of el.children) if (BLOCK_TAGS.has(c.tagName)) return false;
        return true;
      };
      // A div with block children may ALSO carry bare direct text (e.g.
      // <div class="tryit"><div class="label">THIS WEEK</div>bare instruction
      // text<br/>思考：...</div>). That bare text isn't covered by any child
      // element, so we must still include the outer div. Check for any non-
      // whitespace text node child.
      const hasDirectText = (el) => {
        for (const n of el.childNodes) {
          if (n.nodeType === 3 && n.nodeValue.trim()) return true;
        }
        return false;
      };
      const nodes = document.querySelectorAll('h1, h2, h3, h4, p, li, summary, div, span');
      tts.segments = Array.from(nodes).filter((el) => {
        if (!visible(el)) return false;
        if (el.tagName === 'DIV' && !isLeafDiv(el) && !hasDirectText(el)) return false;
        // Spans are only useful when they're direct children of a non-leaf
        // div (e.g. <div class="sec"><span class="label">[Header]</span>
        // <p>...</p></div>) — the label text isn't inside the <p> so nothing
        // else would capture it. Otherwise the parent (leaf div / p / h*)
        // already narrates the span's text.
        if (el.tagName === 'SPAN') {
          const p = el.parentElement;
          if (!p || p.tagName !== 'DIV' || isLeafDiv(p)) return false;
          if (!el.textContent.trim()) return false;
        }
        return true;
      });
    }
    updateProgress();
  }

  // ---------- UI ----------
  function injectStyles() {
    const css = `
body{padding-bottom:96px!important}
body.mmd-tts-on #search-fab{bottom:78px!important}
.mmd-controls{position:fixed;bottom:18px;right:18px;background:rgba(255,255,255,0.98);border-radius:28px;box-shadow:0 6px 24px rgba(0,0,0,0.15);padding:6px;display:flex;align-items:center;gap:2px;z-index:9999;font-family:-apple-system,"Noto Sans SC","Segoe UI",Roboto,sans-serif;border:1px solid rgba(0,0,0,0.06);user-select:none}
.mmd-controls button{background:transparent;border:none;cursor:pointer;padding:8px 11px;border-radius:18px;color:#2d3436;font-size:14px;font-weight:600;line-height:1;display:flex;align-items:center;justify-content:center;transition:background 0.15s,color 0.15s;min-width:36px;min-height:36px}
.mmd-controls button:hover{background:#f0f0f4}
.mmd-controls button.active{background:#6c5ce7;color:#fff}
.mmd-controls button:disabled{opacity:0.35;cursor:default}
.mmd-controls .sep{width:1px;height:18px;background:rgba(0,0,0,0.1);margin:0 3px}
.mmd-controls .rate{background:transparent;border:none;cursor:pointer;font-size:12px;color:#636e72;padding:6px 10px;border-radius:14px;font-weight:600;font-variant-numeric:tabular-nums;min-width:34px;text-align:center}
.mmd-controls .rate:hover{background:#f0f0f4}
.mmd-controls .progress{font-size:11px;color:#8a93a0;padding:0 6px;min-width:38px;text-align:center;font-variant-numeric:tabular-nums;letter-spacing:0.5px}
.mmd-controls .skip{font-size:11px;font-weight:700;letter-spacing:0;padding:8px 8px;min-width:auto}
.mmd-lang-toggle{position:fixed;top:16px;right:16px;z-index:10000;background:rgba(255,255,255,0.98);border-radius:22px;box-shadow:0 4px 16px rgba(0,0,0,0.12);padding:4px;display:flex;align-items:center;gap:0;font-family:-apple-system,"Noto Sans SC","Segoe UI",Roboto,sans-serif;border:1px solid rgba(0,0,0,0.06);user-select:none}
.mmd-lang-toggle button{background:transparent;border:none;cursor:pointer;font-size:13px;font-weight:700;letter-spacing:0.5px;padding:6px 14px;border-radius:18px;color:#636e72;transition:background 0.15s,color 0.15s;line-height:1;min-width:38px}
.mmd-lang-toggle button.active{background:#6c5ce7;color:#fff}
.mmd-lang-toggle button:not(.active):hover{background:#f0f0f4;color:#2d3436}
.mmd-controls .seek-wrap{display:flex;align-items:center;gap:6px;padding:0 4px;min-width:140px}
.mmd-controls .seek-bar{flex:1;height:18px;cursor:pointer;position:relative;display:flex;align-items:center;touch-action:none}
.mmd-controls .seek-bar.disabled{cursor:not-allowed;opacity:0.4}
.mmd-controls .seek-track{position:absolute;left:0;right:0;top:50%;height:4px;margin-top:-2px;background:rgba(0,0,0,0.12);border-radius:2px}
.mmd-controls .seek-fill{position:absolute;left:0;top:50%;height:4px;margin-top:-2px;background:#6c5ce7;border-radius:2px;width:0%;pointer-events:none}
.mmd-controls .seek-knob{position:absolute;top:50%;width:12px;height:12px;border-radius:50%;background:#6c5ce7;transform:translate(-50%,-50%);box-shadow:0 1px 3px rgba(0,0,0,0.25);left:0;opacity:0;transition:opacity 0.15s;pointer-events:none}
.mmd-controls .seek-bar:hover .seek-knob,.mmd-controls .seek-bar.scrubbing .seek-knob{opacity:1}
.mmd-controls .seek-time{font-size:11px;color:#8a93a0;font-variant-numeric:tabular-nums;min-width:36px;text-align:right}
.tts-active{background:rgba(108,92,231,0.10)!important;box-shadow:0 0 0 2px rgba(108,92,231,0.35),0 0 0 6px rgba(108,92,231,0.08);border-radius:6px;transition:background 0.2s,box-shadow 0.2s;scroll-margin-top:80px;scroll-margin-bottom:120px}
/* Ring-only highlight for gradient-clipped text: no background override,
   so the glyphs (which the gradient paints) stay visible. */
.tts-active-ring{box-shadow:0 0 0 2px rgba(108,92,231,0.35),0 0 0 6px rgba(108,92,231,0.08);border-radius:6px;transition:box-shadow 0.2s;scroll-margin-top:80px;scroll-margin-bottom:120px}
@media(max-width:600px){
  .mmd-controls{bottom:10px;right:10px;left:10px;justify-content:center;border-radius:22px;padding:5px}
  .mmd-controls button{min-width:32px;min-height:32px;padding:6px 8px}
  .mmd-controls .progress{display:none}
  .mmd-controls .skip{padding:6px 5px;font-size:10px}
  .mmd-controls .seek-wrap{min-width:0;flex:1}
  .mmd-controls .seek-time{display:none}
  .mmd-lang-toggle{top:10px;right:10px}
  .mmd-lang-toggle button{padding:5px 10px;font-size:12px;min-width:32px}
}
`;
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  }

  function injectControls() {
    // Top-right: language toggle (separated from playback controls).
    // Idempotent, same rule as index-button.js: some pages hard-code their own
    // toggle in the HTML (blog-pipeline, the synthesis essays). Injecting a
    // second one stacks two switchers in the same corner — worst on mobile,
    // where this bar sits at top:10px and a hand-written .lang-toggle at
    // top:18px, so they overlap by design.
    let langBar = null;
    if (!document.querySelector('.lang-toggle, .mmd-lang-toggle')) {
      langBar = document.createElement('div');
      langBar.className = 'mmd-lang-toggle';
      langBar.setAttribute('role', 'group');
      langBar.setAttribute('aria-label', 'Language toggle');
      langBar.innerHTML = `
        <button data-action="lang-zh" aria-label="中文">中文</button>
        <button data-action="lang-en" aria-label="English">EN</button>
      `;
      document.body.appendChild(langBar);
    }

    // Bottom-right: playback controls
    const bar = document.createElement('div');
    bar.className = 'mmd-controls';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Audio controls');
    bar.innerHTML = `
      <button data-action="prev" title="上一段 / Previous" aria-label="Previous segment">⏮</button>
      <button class="skip" data-action="back10" title="后退 10 秒 / Back 10s" aria-label="Back 10 seconds">−10</button>
      <button class="play-btn" data-action="play" title="播放 / 暂停" aria-label="Play or pause">▶</button>
      <button class="skip" data-action="fwd10" title="快进 10 秒 / Forward 10s" aria-label="Forward 10 seconds">+10</button>
      <button data-action="next" title="下一段 / Next" aria-label="Next segment">⏭</button>
      <button data-action="stop" title="停止 / Stop" aria-label="Stop">■</button>
      <span class="progress" aria-live="polite">0/0</span>
      <div class="seek-wrap">
        <div class="seek-bar disabled" role="slider" aria-label="Seek within current segment" tabindex="0" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="seek-track"></div>
          <div class="seek-fill"></div>
          <div class="seek-knob"></div>
        </div>
        <span class="seek-time">0:00</span>
      </div>
      <span class="sep"></span>
      <button class="rate" data-action="rate" title="语速 / Speed" aria-label="Playback speed">1×</button>
    `;
    document.body.appendChild(bar);
    // TTS bar and the shared search FAB are both bottom-right; flag body so CSS
    // lifts #search-fab above the bar (scoped: only when the bar is present).
    document.body.classList.add('mmd-tts-on');

    if (langBar) langBar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const targetLang = btn.dataset.action === 'lang-zh' ? 'zh' : 'en';
      if (splitMode) {
        // Navigate to the other-language file if it differs from current
        if (targetLang !== currentLang) window.location.assign(otherLangUrl());
      } else {
        applyLang(targetLang);
      }
    });

    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      switch (btn.dataset.action) {
        case 'play': (tts.playing && !tts.paused) ? tts.pause() : tts.play(); break;
        case 'stop': tts.stop(); break;
        case 'next': tts.next(); break;
        case 'prev': tts.prev(); break;
        case 'back10': tts.skip(-10); break;
        case 'fwd10': tts.skip(10); break;
        case 'rate': {
          const i = RATES.indexOf(tts.rate);
          tts.setRate(RATES[(i + 1) % RATES.length]);
          break;
        }
      }
    });
  }

  function updatePlayButton() {
    const btn = document.querySelector('.mmd-controls .play-btn');
    if (!btn) return;
    btn.textContent = (tts.playing && !tts.paused) ? '⏸' : '▶';
    btn.classList.toggle('active', tts.playing && !tts.paused);
  }

  function updateProgress() {
    const el = document.querySelector('.mmd-controls .progress');
    if (!el) return;
    const total = tts.segments.length;
    const cur = tts.idx >= 0 ? tts.idx + 1 : 0;
    el.textContent = `${cur}/${total}`;
  }

  function updateLangButton() {
    const zhBtn = document.querySelector('.mmd-lang-toggle [data-action="lang-zh"]');
    const enBtn = document.querySelector('.mmd-lang-toggle [data-action="lang-en"]');
    if (!zhBtn || !enBtn) return;
    zhBtn.classList.toggle('active', currentLang === 'zh');
    enBtn.classList.toggle('active', currentLang === 'en');
  }

  function updateRateLabel() {
    const el = document.querySelector('.mmd-controls .rate');
    if (el) el.textContent = `${tts.rate}×`;
  }

  // ---------- Seek bar ----------
  let isScrubbing = false;

  // Robust duration: audio.duration can be Infinity/NaN for header-less mp3s,
  // so fall back to the end of the seekable range when available.
  function durationOf(audio) {
    if (!audio) return 0;
    const d = audio.duration;
    if (isFinite(d) && d > 0) return d;
    try {
      const sk = audio.seekable;
      if (sk && sk.length) {
        const end = sk.end(sk.length - 1);
        if (isFinite(end) && end > 0) return end;
      }
    } catch (e) {}
    return 0;
  }

  // Force the browser to compute a real duration for streamed/header-less mp3s
  // by seeking far past the end; it clamps and fires durationchange with the
  // true length, after which we restore playback to the start.
  function primeDuration(audio, isStale) {
    if (audio._priming || (isFinite(audio.duration) && audio.duration > 0)) return;
    audio._priming = true;
    const cleanup = () => {
      audio.removeEventListener('durationchange', onResolve);
      audio.removeEventListener('timeupdate', onResolve);
    };
    const onResolve = () => {
      if (isStale && isStale()) { cleanup(); audio._priming = false; return; }
      if (isFinite(audio.duration) && audio.duration > 0) {
        cleanup();
        try { audio.currentTime = 0; } catch (e) {}
        audio._priming = false;
        setSeekEnabled(true);
        if (!isScrubbing) updateSeek(0, audio.duration);
      }
    };
    audio.addEventListener('durationchange', onResolve);
    audio.addEventListener('timeupdate', onResolve);
    try { audio.currentTime = 1e7; } catch (e) { audio._priming = false; }
  }

  function fmtTime(s) {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  function updateSeek(currentTime, duration) {
    const fill = document.querySelector('.mmd-controls .seek-fill');
    const knob = document.querySelector('.mmd-controls .seek-knob');
    const time = document.querySelector('.mmd-controls .seek-time');
    const bar = document.querySelector('.mmd-controls .seek-bar');
    if (!fill) return;
    const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
    fill.style.width = pct + '%';
    if (knob) knob.style.left = pct + '%';
    if (time) time.textContent = duration > 0
      ? `${fmtTime(currentTime)} / ${fmtTime(duration)}`
      : '0:00';
    if (bar) bar.setAttribute('aria-valuenow', String(Math.round(pct)));
  }

  function setSeekEnabled(enabled) {
    const bar = document.querySelector('.mmd-controls .seek-bar');
    if (bar) bar.classList.toggle('disabled', !enabled);
  }

  function wireSeekBar() {
    const bar = document.querySelector('.mmd-controls .seek-bar');
    if (!bar) return;

    // clientX − rect.left (NOT offsetX, which is wrong once the pointer leaves
    // the bar), clamped to [0,1].
    const fractionFromX = (clientX) => {
      const rect = bar.getBoundingClientRect();
      if (!rect.width) return 0;
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    };

    const previewAt = (f) => {
      const dur = durationOf(tts.audio);
      if (dur > 0) updateSeek(f * dur, dur);
    };

    // Pointer Events unify mouse / touch / pen; setPointerCapture keeps the
    // drag alive even when the pointer slides outside the (small) bar.
    const onDown = (e) => {
      if (bar.classList.contains('disabled') || !tts.audio) return;
      e.preventDefault();
      isScrubbing = true;
      bar.classList.add('scrubbing');
      try { bar.setPointerCapture(e.pointerId); } catch (err) {}
      previewAt(fractionFromX(e.clientX));
    };
    const onMove = (e) => {
      if (!isScrubbing) return;
      e.preventDefault();
      previewAt(fractionFromX(e.clientX));
    };
    const onUp = (e) => {
      if (!isScrubbing) return;
      e.preventDefault();
      const f = fractionFromX(e.clientX);
      isScrubbing = false;
      bar.classList.remove('scrubbing');
      try { bar.releasePointerCapture(e.pointerId); } catch (err) {}
      tts.seekTo(f);
    };

    bar.addEventListener('pointerdown', onDown);
    bar.addEventListener('pointermove', onMove);
    bar.addEventListener('pointerup', onUp);
    bar.addEventListener('pointercancel', onUp);

    // Keyboard support (arrows = ±5s)
    bar.addEventListener('keydown', (e) => {
      if (!tts.audio || bar.classList.contains('disabled')) return;
      const dur = durationOf(tts.audio);
      if (!dur) return;
      const step = 5;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        tts.audio.currentTime = Math.max(0, tts.audio.currentTime - step);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        tts.audio.currentTime = Math.min(dur, tts.audio.currentTime + step);
      }
    });
  }

  // ---------- Init ----------
  function init() {
    injectStyles();
    injectControls();
    wireSeekBar();
    if (splitMode) {
      // In split mode the page is already the right language; just mark the
      // toggle UI to reflect that and skip attribute-based content swap.
      const zhBtn = document.querySelector('.mmd-lang-toggle [data-action="lang-zh"]');
      const enBtn = document.querySelector('.mmd-lang-toggle [data-action="lang-en"]');
      if (zhBtn && enBtn) {
        zhBtn.classList.toggle('active', currentLang === 'zh');
        enBtn.classList.toggle('active', currentLang === 'en');
      }
    } else {
      applyLang(currentLang);
    }
    updateRateLabel();
    rebuildSegments();

    // Pages with toggled panels (cs-papers' 科普版/精读版) swap the [hidden]
    // attribute; the segment list must follow or the bar keeps offering the
    // copy that is no longer on screen.
    const panels = document.querySelectorAll('[hidden], .mode');
    if (panels.length) {
      const obs = new MutationObserver(() => {
        if (tts.playing) return;
        rebuildSegments();
      });
      panels.forEach((el) => obs.observe(el, { attributes: true, attributeFilter: ['hidden', 'style', 'class'] }));
    }
    if ('speechSynthesis' in window && speechSynthesis.getVoices().length === 0) {
      speechSynthesis.addEventListener?.('voiceschanged', () => {}, { once: true });
    }
    window.addEventListener('beforeunload', () => {
      if ('speechSynthesis' in window) speechSynthesis.cancel();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
