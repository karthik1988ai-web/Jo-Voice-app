/*
 * Jo's voice visualizer: the spectrum ring around the core, the waveform under it, live captions
 * of what Jo is saying and the key-figure readouts. jo-ui.js drives it through window.JoViz:
 *   setMode(mode)            idle | listening | thinking | speaking | error
 *   say(text, lang, figures) show captions and figures for a reply about to be spoken
 *   wordAt(charIndex)        exact position from the voice engine (PC voices report it)
 *   setAnalyser(node)        a Web Audio AnalyserNode for the Gemini voice (real levels)
 */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ns = "http://www.w3.org/2000/svg";

  let mode = "idle", analyser = null, freq = null, wave = null;
  let words = [], spokenFrom = 0, wordsPerSec = 2.6, exactIndex = -1, lastShown = -1;
  let level = 0; // smoothed 0..1 loudness

  // ---------- spectrum ring around the core ----------
  const bars = [];
  const barGroup = $("bars");
  if (barGroup) {
    for (let i = 0; i < 72; i++) {
      const l = document.createElementNS(ns, "line");
      l.dataset.a = String((i / 72) * Math.PI * 2 - Math.PI / 2);
      barGroup.appendChild(l);
      bars.push(l);
    }
  }

  // ---------- waveform under the core ----------
  const canvas = $("wave");
  const ctx = canvas ? canvas.getContext("2d") : null;
  function sizeCanvas() {
    if (!canvas) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  addEventListener("resize", sizeCanvas);

  // Loudness: the real signal for the Gemini voice; for phone/PC voices (which can't be measured)
  // a speech-like rhythm of syllables.
  function measure(t) {
    if (analyser && mode === "speaking") {
      analyser.getByteTimeDomainData(wave);
      let sum = 0;
      for (let i = 0; i < wave.length; i++) { const v = (wave[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / wave.length);
      if (rms > 0.004) return Math.min(1, rms * 7);
    }
    if (mode === "speaking") {
      const syllable = Math.abs(Math.sin(t / 95)) * (0.55 + 0.45 * Math.sin(t / 410));
      const phrase = 0.65 + 0.35 * Math.sin(t / 1300);
      return Math.max(0.12, syllable * phrase);
    }
    if (mode === "listening") return 0.28 + 0.12 * Math.sin(t / 260);
    if (mode === "thinking") return 0.16 + 0.06 * Math.sin(t / 120);
    return 0.05;
  }

  function drawBars(t) {
    const useFreq = analyser && mode === "speaking";
    if (useFreq) analyser.getByteFrequencyData(freq);
    const k = { speaking: 1, listening: 0.6, thinking: 0.45, error: 0.3 }[mode] || 0.18;
    bars.forEach((l, i) => {
      const a = +l.dataset.a;
      let v;
      if (useFreq) {
        // mirror the lower spectrum around the ring
        const idx = Math.floor((i < 36 ? i : 71 - i) * (freq.length * 0.45) / 36);
        v = freq[idx] / 255;
      } else {
        v = ((Math.sin(t / 170 + i * 0.6) + Math.sin(t / 83 + i * 1.7) + 2) / 4) * level * 1.6;
      }
      const len = 3 + Math.min(1, v) * 30 * k + level * 6;
      const r1 = 104, r2 = r1 + len;
      l.setAttribute("x1", (200 + Math.cos(a) * r1).toFixed(1)); l.setAttribute("y1", (200 + Math.sin(a) * r1).toFixed(1));
      l.setAttribute("x2", (200 + Math.cos(a) * r2).toFixed(1)); l.setAttribute("y2", (200 + Math.sin(a) * r2).toFixed(1));
    });
  }

  function drawWave(t) {
    if (!ctx) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width < w) sizeCanvas();
    ctx.clearRect(0, 0, w, h);
    const color = mode === "thinking" ? "255,181,71" : mode === "error" ? "255,92,122" : "62,230,255";
    const layers = [[1, 0.9, 2], [0.6, 0.45, 1.2], [0.35, 0.25, 1]];
    layers.forEach(([amp, alpha, width], li) => {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 3) {
        const p = x / w;
        const envelope = Math.sin(p * Math.PI) ** 1.6; // quiet at the edges
        const y = h / 2 + Math.sin(p * (14 + li * 5) + t / (180 - li * 40)) * Math.sin(p * 5 - t / 600)
          * envelope * amp * (h * 0.46) * (0.08 + level);
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(${color},${alpha})`;
      ctx.lineWidth = width;
      ctx.shadowColor = `rgba(${color},0.8)`;
      ctx.shadowBlur = li === 0 ? 8 : 0;
      ctx.stroke();
    });
    ctx.shadowBlur = 0;
  }

  // ---------- captions ----------
  const caption = $("caption");
  function renderCaption(text, lang) {
    if (!caption) return;
    caption.classList.toggle("ta", lang === "ta");
    caption.innerHTML = "";
    words = [];
    let pos = 0;
    String(text).split(/(\s+)/).forEach((part) => {
      if (/^\s+$/.test(part) || !part) { caption.appendChild(document.createTextNode(part)); pos += part.length; return; }
      const span = document.createElement("span");
      span.textContent = part;
      caption.appendChild(span);
      words.push({ span, start: pos });
      pos += part.length;
    });
    lastShown = -1; exactIndex = -1;
    caption.classList.add("show");
  }
  function updateCaption(t) {
    if (!words.length || mode !== "speaking") return;
    let n = exactIndex >= 0 ? exactIndex : Math.floor(((t - spokenFrom) / 1000) * wordsPerSec);
    n = Math.min(words.length - 1, Math.max(0, n));
    if (n === lastShown) return;
    for (let i = Math.max(0, lastShown); i <= n; i++) words[i].span.className = i === n ? "now" : "said";
    lastShown = n;
    const span = words[n].span;
    caption.scrollTop = Math.max(0, span.offsetTop - caption.clientHeight / 2);
  }
  function finishCaption() {
    words.forEach((w) => { w.span.className = "said"; });
    clearTimeout(finishCaption.timer);
    finishCaption.timer = setTimeout(() => caption && caption.classList.remove("show"), 7000);
  }

  // ---------- key figures ----------
  const figuresEl = $("figures");
  function renderFigures(list) {
    if (!figuresEl) return;
    figuresEl.innerHTML = "";
    (list || []).forEach((f, i) => {
      const card = document.createElement("div");
      card.className = "figure";
      card.style.animationDelay = `${0.15 + i * 0.18}s`;
      card.innerHTML = '<div class="fig-value"></div><div class="fig-label"></div>';
      card.querySelector(".fig-label").textContent = f.label;
      const valueEl = card.querySelector(".fig-value");
      figuresEl.appendChild(card);
      countUp(valueEl, f.value, 0.15 + i * 0.18);
    });
  }
  // Counts the number up from zero, keeping its ₹ sign, commas and units.
  function countUp(el, value, delay) {
    const m = /^(\D*)([\d,]+(?:\.\d+)?)(.*)$/.exec(value);
    if (!m || reduced) { el.textContent = value; return; }
    const [, pre, num, post] = m;
    const target = parseFloat(num.replace(/,/g, ""));
    const decimals = (num.split(".")[1] || "").length;
    const commas = num.includes(",");
    const start = performance.now() + delay * 1000, dur = 900;
    const fmt = (v) => {
      const s = v.toFixed(decimals);
      return commas ? Number(s).toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : s;
    };
    el.textContent = pre + fmt(0) + post;
    const step = (now) => {
      const p = Math.min(1, Math.max(0, (now - start) / dur));
      el.textContent = pre + fmt(target * (1 - (1 - p) ** 3)) + post;
      if (p < 1) requestAnimationFrame(step); else el.textContent = value;
    };
    requestAnimationFrame(step);
  }

  // ---------- loop ----------
  const stage = $("stage");
  function frame(t) {
    level += (measure(t) - level) * 0.25;
    drawBars(t);
    drawWave(t);
    updateCaption(t);
    if (stage) stage.style.setProperty("--level", level.toFixed(3));
    requestAnimationFrame(frame);
  }
  sizeCanvas();
  if (reduced) { drawBars(0); drawWave(0); } else requestAnimationFrame(frame);

  window.JoViz = {
    setMode(m) {
      const was = mode;
      mode = m;
      if (m === "speaking" && was !== "speaking") spokenFrom = performance.now();
      if (was === "speaking" && m !== "speaking") finishCaption();
      if (reduced) { drawBars(0); drawWave(0); }
    },
    say(text, lang, figures) {
      wordsPerSec = lang === "ta" ? 1.8 : 2.6;
      renderCaption(text, lang);
      renderFigures(figures);
    },
    wordAt(charIndex) {
      let i = words.findIndex((w) => w.start > charIndex);
      exactIndex = Math.max(0, (i < 0 ? words.length : i) - 1);
    },
    setAnalyser(node) {
      analyser = node;
      freq = new Uint8Array(node.frequencyBinCount);
      wave = new Uint8Array(node.fftSize);
    },
    clear() { if (caption) caption.classList.remove("show"); renderFigures([]); },
  };
})();
