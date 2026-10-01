/*
 * Jo inside the Android app. Android's WebView has no speech recognition, no PC voices, no web
 * notifications and no page full screen, so this file supplies them from the phone through the
 * JoNative channel (phone/src/main/java/com/karthik/jo/phone/NativeBridge.kt). In a normal
 * browser JoNative doesn't exist and this file does nothing.
 */
(function () {
  "use strict";
  const N = window.JoNative;
  if (!N) return;
  window.JoApp = true;

  const send = (m) => N.postMessage(JSON.stringify(m));
  const handlers = {};
  N.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    const h = handlers[m.t];
    if (h) h(m);
  };
  let seq = 0;
  const nextId = () => String(++seq);

  // ---------- speech recognition (the phone's recognizer) ----------
  const recs = new Map();
  class PhoneRecognition {
    constructor() {
      this.lang = ""; this.continuous = false; this.interimResults = false; this.maxAlternatives = 1;
      this.onstart = this.onresult = this.onerror = this.onend = null;
      this._id = null; this._results = [];
    }
    start() {
      if (this._id) throw new DOMException("Recognition has already started.", "InvalidStateError");
      this._id = nextId(); this._results = [];
      recs.set(this._id, this);
      send({ t: "rec.start", id: this._id, lang: this.lang || navigator.language, continuous: !!this.continuous, interim: !!this.interimResults });
    }
    stop() { if (this._id) send({ t: "rec.stop", id: this._id }); }
    abort() { if (this._id) send({ t: "rec.abort", id: this._id }); }
  }
  handlers["rec.start"] = (m) => { const r = recs.get(m.id); if (r && r.onstart) r.onstart({}); };
  handlers["rec.result"] = (m) => {
    const r = recs.get(m.id); if (!r) return;
    const res = [{ transcript: m.text, confidence: m.final ? 0.9 : 0 }];
    res.isFinal = !!m.final;
    const list = r._results, last = list[list.length - 1];
    // Like Chrome: a phrase's in-progress words are replaced until the phrase is final.
    const index = last && !last.isFinal ? list.length - 1 : list.length;
    list[index] = res;
    if (r.onresult && (m.final || r.interimResults)) r.onresult({ resultIndex: index, results: list });
  };
  handlers["rec.error"] = (m) => { const r = recs.get(m.id); if (r && r.onerror) r.onerror({ error: m.error, message: m.message || "" }); };
  handlers["rec.end"] = (m) => {
    const r = recs.get(m.id); if (!r) return;
    recs.delete(m.id); r._id = null;
    if (r.onend) r.onend({});
  };
  window.SpeechRecognition = window.webkitSpeechRecognition = PhoneRecognition;

  // ---------- text to speech (the phone's voices) ----------
  let voices = [];
  const voiceListeners = [];
  const queue = [];
  let current = null;
  class PhoneUtterance {
    constructor(text) {
      this.text = text || ""; this.lang = ""; this.voice = null; this.rate = 1; this.pitch = 1; this.volume = 1;
      this.onstart = this.onend = this.onerror = null;
    }
  }
  const synth = {
    speaking: false, pending: false, paused: false, onvoiceschanged: null,
    getVoices: () => voices.slice(),
    speak(u) { queue.push(u); pump(); },
    cancel() {
      queue.length = 0;
      if (!current) return;
      const u = current; current = null; synth.speaking = false;
      send({ t: "tts.cancel" });
      if (u.onend) u.onend({});
    },
    pause() {}, resume() {},
    addEventListener(type, fn) { if (type === "voiceschanged") voiceListeners.push(fn); },
    removeEventListener(type, fn) { const i = voiceListeners.indexOf(fn); if (i >= 0) voiceListeners.splice(i, 1); },
  };
  function pump() {
    if (current || !queue.length) return;
    current = queue.shift();
    current._id = nextId();
    synth.speaking = true;
    send({ t: "tts.speak", id: current._id, text: current.text, lang: current.lang || (current.voice && current.voice.lang) || "",
      voice: (current.voice && current.voice.name) || "", rate: current.rate || 1 });
  }
  function finish(m, failed) {
    if (!current || current._id !== m.id) return;
    const u = current; current = null; synth.speaking = false;
    if (failed && u.onerror) u.onerror({ error: "synthesis-failed" });
    else if (u.onend) u.onend({});
    pump();
  }
  handlers["tts.start"] = (m) => { if (current && current._id === m.id && current.onstart) current.onstart({}); };
  handlers["tts.end"] = (m) => finish(m, false);
  handlers["tts.error"] = (m) => finish(m, true);
  handlers["tts.voices"] = (m) => {
    voices = (m.voices || []).map((v) => ({ name: v.name, lang: v.lang, voiceURI: v.name, localService: true, default: false }));
    if (synth.onvoiceschanged) synth.onvoiceschanged({});
    voiceListeners.forEach((fn) => fn({}));
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = PhoneUtterance;

  // ---------- notifications ----------
  class PhoneNotification {
    constructor(title, opts) { this.onclick = null; send({ t: "notify", title: String(title), body: String((opts && opts.body) || "") }); }
    close() {}
    static get permission() { return "granted"; } // the phone asks once when Jo starts
    static requestPermission() { send({ t: "notify.permission" }); return Promise.resolve("granted"); }
  }
  window.Notification = PhoneNotification;

  // ---------- full screen (hides the phone's status and navigation bars) ----------
  let full = false;
  Object.defineProperty(document, "fullscreenElement", { get: () => (full ? document.documentElement : null), configurable: true });
  Element.prototype.requestFullscreen = function () { send({ t: "fullscreen", on: true }); return Promise.resolve(); };
  document.exitFullscreen = function () { send({ t: "fullscreen", on: false }); return Promise.resolve(); };
  handlers["fullscreen"] = (m) => { full = !!m.on; document.dispatchEvent(new Event("fullscreenchange")); };

  send({ t: "hello" });
})();
