/* Jo UI: wires the HUD to JoCore (voice, panels, settings, brief and reminders). */
(function () {
  "use strict";
  const { Gemini, Supabase, Bridge, BridgeApp, GoogleWorkspace, TaskStore, Tools, Agent, DEFAULT_MODEL, DEFAULT_TTS_MODEL, GEMINI_VOICES, formatTime, isoDate, startOfToday } = window.JoCore;
  const formatAgo = (ms) => {
    const min = Math.round((Date.now() - ms) / 60000);
    if (min < 1) return "just now";
    if (min < 60) return `${min} min ago`;
    if (min < 24 * 60) return `${Math.round(min / 60)} h ago`;
    return formatTime(ms);
  };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // ---------- storage (falls back to memory if the browser blocks it) ----------
  const memory = new Map();
  const storage = {
    getItem(k) { try { return localStorage.getItem(k); } catch { return memory.get(k) ?? null; } },
    setItem(k, v) { try { localStorage.setItem(k, v); } catch { memory.set(k, String(v)); } },
  };
  const readJson = (k, fallback) => { try { return JSON.parse(storage.getItem(k)) ?? fallback; } catch { return fallback; } };

  const DEFAULTS = {
    geminiKey: "", geminiModel: DEFAULT_MODEL, bridgeUrl: "", bridgeKey: "",
    kavery: { viaBridge: true, url: "", key: "", tables: "", fn: "", lookupFn: "" },
    thirumal: { viaBridge: true, url: "", key: "", tables: "", fn: "", lookupFn: "" },
    tamil: false, speak: true,
    googleConnected: false, googleTasks: true,
    voiceEngine: "gemini", geminiVoiceEn: "Charon", geminiVoiceTa: "Kore", pcVoiceEn: "", pcVoiceTa: "", ttsModel: "",
    briefEnabled: true, briefTime: "08:00", mailCheckMinutes: 3, announceMail: true,
  };
  let settings = { ...DEFAULTS, ...readJson("jo.settings", {}) };
  settings.kavery = { ...DEFAULTS.kavery, ...settings.kavery };
  settings.thirumal = { ...DEFAULTS.thirumal, ...settings.thirumal };
  const saveSettings = () => storage.setItem("jo.settings", JSON.stringify(settings));

  const tasks = new TaskStore(storage);
  const health = readJson("jo.health", {}); // last test result per system: "ok" | "err"
  const setHealth = (k, v) => { health[k] = v; storage.setItem("jo.health", JSON.stringify(health)); renderSystems(); };

  // ---------- Jo's brain ----------
  let agent = null;
  function buildTools() {
    const bridge = settings.bridgeUrl && settings.bridgeKey ? new Bridge(settings.bridgeUrl, settings.bridgeKey) : null;
    // Through the bridge by default; a direct connection only if switched off and a URL + key are set.
    const app = (name, id, c) => (c.viaBridge !== false ? (bridge ? new BridgeApp(name, id, bridge) : null)
      : (c.url && c.key ? new Supabase(name, c) : null));
    return new Tools({
      bridge,
      kavery: app("Kavery Delivery", "kavery", settings.kavery),
      thirumal: app("Thirumal", "thirumal", settings.thirumal),
      tasks,
      // Tasks and events go to the Google account once it's connected (and the option is on).
      google: bridge && settings.googleConnected && settings.googleTasks !== false ? new GoogleWorkspace(bridge) : null,
    });
  }
  function getAgent() {
    if (!settings.geminiKey) return null;
    if (!agent) agent = new Agent(new Gemini(settings.geminiKey, settings.geminiModel), buildTools(), settings.tamil);
    return agent;
  }

  // ---------- HUD state ----------
  const reactor = $("reactor"), stateEl = $("state");
  const TOOL_LABELS = {
    get_unread_mail: "CHECKING MAIL", search_mail: "SEARCHING MAIL", read_mail: "READING MAIL",
    get_app_summary: "QUERYING BUSINESS DATA", search_app_records: "SEARCHING RECORDS", describe_app_tables: "SCANNING DATABASE", query_app_data: "QUERYING DATABASE",
    list_tasks: "CHECKING TASKS", add_task: "ADDING TASK", complete_task: "UPDATING TASK", delete_task: "UPDATING TASK",
    list_events: "CHECKING AGENDA", add_event: "ADDING TO AGENDA",
  };
  function setState(mode, label) {
    window.JoGraph?.setActivity(mode);
    reactor.className = `reactor ${mode}`;
    stateEl.className = `state ${mode}`;
    stateEl.textContent = label || {
      idle: matchMedia("(pointer: coarse)").matches ? "STANDING BY · TAP TO TALK" : "STANDING BY · PRESS SPACE OR TAP TO TALK", listening: "LISTENING…", thinking: "PROCESSING…", speaking: "SPEAKING", error: "ATTENTION",
    }[mode];
  }

  // Audio-style bars around the core (animated while speaking/listening)
  const bars = [];
  (function makeBars() {
    const g = $("bars"), ns = "http://www.w3.org/2000/svg";
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2, l = document.createElementNS(ns, "line");
      l.dataset.a = a;
      g.appendChild(l);
      bars.push(l);
    }
    const draw = (t) => {
      const mode = reactor.classList.contains("speaking") ? 2 : reactor.classList.contains("listening") ? 1 : reactor.classList.contains("thinking") ? 0.6 : 0.15;
      bars.forEach((l, i) => {
        const a = +l.dataset.a;
        const wave = (Math.sin(t / 180 + i * 0.7) + Math.sin(t / 97 + i * 1.3) + 2) / 4;
        const len = 4 + wave * 16 * mode;
        const r1 = 104, r2 = r1 + len;
        l.setAttribute("x1", 200 + Math.cos(a) * r1); l.setAttribute("y1", 200 + Math.sin(a) * r1);
        l.setAttribute("x2", 200 + Math.cos(a) * r2); l.setAttribute("y2", 200 + Math.sin(a) * r2);
      });
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  })();

  // ---------- transcript ----------
  const transcript = $("transcript");
  function addMsg(who, text, opts = {}) {
    const div = document.createElement("div");
    div.className = `msg ${who}${opts.error ? " err" : ""}`;
    div.innerHTML = `<div><div class="who">${who === "me" ? "YOU" : "JO"}</div><div class="bubble${settings.tamil ? " ta" : ""}">${esc(text)}</div>${
      opts.tools?.length ? `<div class="tools">checked: ${esc([...new Set(opts.tools)].map((t) => t.replace(/_/g, " ")).join(", "))}</div>` : ""}</div>`;
    transcript.appendChild(div);
    transcript.scrollTop = transcript.scrollHeight;
  }

  // ---------- speech out ----------
  // Gemini AI voices (natural, need internet and count against the free daily limit) or the
  // PC's own voices (instant, offline). Short alerts always use the PC voice to save quota.
  let voices = [];
  const loadVoices = () => { voices = speechSynthesis.getVoices(); if (!$("settings").hidden) fillVoiceSelects(); };
  if ("speechSynthesis" in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }

  let audioCtx = null, currentSource = null, speakSeq = 0, warnedGeminiVoice = false;
  function ensureAudio() {
    if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx?.state === "suspended") audioCtx.resume();
    return audioCtx;
  }
  // Browsers only allow sound after a click or key press; prepare audio on the first one.
  ["pointerdown", "keydown"].forEach((ev) => addEventListener(ev, ensureAudio, { once: true }));

  function stopSpeaking() {
    speakSeq++;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    if (currentSource) { try { currentSource.stop(); } catch { /* already stopped */ } currentSource = null; }
  }
  const isSpeaking = () => !!currentSource || ("speechSynthesis" in window && speechSynthesis.speaking);

  function pcVoice(lang, name) {
    const re = lang === "ta" ? /^ta/i : /^en/i;
    const chosen = name && voices.find((v) => v.name === name);
    if (chosen) return chosen;
    const pick = (r) => voices.find((v) => r.test(v.lang) && /natural|online|google/i.test(v.name)) || voices.find((v) => r.test(v.lang));
    return lang === "ta" ? pick(re) : pick(/^en-IN/i) || pick(/^en-GB/i) || pick(re);
  }

  function speakWithPc(text, lang, name, seq) {
    if (!("speechSynthesis" in window)) { setState("idle"); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.voice = pcVoice(lang, name) || null;
    u.lang = u.voice?.lang || (lang === "ta" ? "ta-IN" : "en-IN");
    if (lang === "ta" && !u.voice) toast("No Tamil PC voice found. Microsoft Edge has one built in, or choose the Gemini AI voice.");
    u.rate = 1.02;
    u.onstart = () => { if (seq === speakSeq) setState("speaking"); };
    u.onend = u.onerror = () => { if (seq === speakSeq) setState("idle"); };
    speechSynthesis.speak(u);
  }

  function playPcm({ data, rate }, seq) {
    const ctx = ensureAudio();
    if (!ctx) throw new Error("This browser can't play audio.");
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    const samples = new Float32Array(Math.floor(bytes.length / 2));
    for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
    const buffer = ctx.createBuffer(1, samples.length, rate);
    buffer.copyToChannel(samples, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.onended = () => { if (currentSource === src) { currentSource = null; if (seq === speakSeq) setState("idle"); } };
    currentSource = src;
    setState("speaking");
    src.start();
  }

  /**
   * Speaks [text]. opts: lang ("en"/"ta", default from the language switch), engine, voice,
   * quick (short alert: always the PC voice), force (speak even when replies are muted).
   */
  async function speak(text, opts = {}) {
    if (!opts.force && !settings.speak) { setState("idle"); return; }
    stopSpeaking();
    const seq = speakSeq;
    const lang = opts.lang || (settings.tamil ? "ta" : "en");
    const engine = opts.quick ? "browser" : opts.engine || settings.voiceEngine;
    if (engine === "gemini" && settings.geminiKey) {
      const voice = opts.voice || (lang === "ta" ? settings.geminiVoiceTa : settings.geminiVoiceEn) || "Charon";
      try {
        setState("thinking", "PREPARING VOICE");
        const style = lang === "ta" ? "" : "Say in a calm, clear, friendly voice with a light Indian English accent:";
        const audio = await new Gemini(settings.geminiKey, settings.geminiModel).speech(text, voice, settings.ttsModel || DEFAULT_TTS_MODEL, style);
        if (seq !== speakSeq) return; // something newer started meanwhile
        playPcm(audio, seq);
        return;
      } catch (e) {
        if (seq !== speakSeq) return;
        if (!warnedGeminiVoice || opts.voice) toast(`${e.message} Using the PC voice instead.`);
        warnedGeminiVoice = true;
      }
    }
    const pcName = opts.engine === "browser" && opts.voice ? opts.voice : lang === "ta" ? settings.pcVoiceTa : settings.pcVoiceEn;
    speakWithPc(text, lang, pcName, seq);
  }

  const SAMPLE = {
    en: "Good morning Karthik. Kavery had fourteen orders today, and three payments are pending.",
    ta: "வணக்கம் கார்த்திக். இன்று காவேரியில் பதினான்கு ஆர்டர்கள் வந்துள்ளன. மூன்று பணம் நிலுவையில் உள்ளது.",
  };

  // Voice pickers in Settings: Gemini voices or this PC's voices for each language.
  function fillVoiceSelects() {
    const engine = $("voice-engine").value;
    ["en", "ta"].forEach((lang) => {
      const sel = $(`voice-${lang}`);
      const key = engine === "gemini" ? (lang === "ta" ? "geminiVoiceTa" : "geminiVoiceEn") : (lang === "ta" ? "pcVoiceTa" : "pcVoiceEn");
      const current = sel.dataset.engine === engine && sel.value ? sel.value : settings[key];
      if (engine === "gemini") {
        sel.innerHTML = GEMINI_VOICES.map(([n, d]) => `<option value="${n}">${n} · ${esc(d)}</option>`).join("");
      } else {
        const re = lang === "ta" ? /^ta/i : /^en/i;
        const list = voices.filter((v) => re.test(v.lang));
        sel.innerHTML = '<option value="">Automatic</option>' + list.map((v) => `<option value="${esc(v.name)}">${esc(v.name)} (${esc(v.lang)})</option>`).join("")
          + (list.length ? "" : `<option value="" disabled>No ${lang === "ta" ? "Tamil" : "English"} voice on this PC</option>`);
      }
      sel.value = current || (engine === "gemini" ? (lang === "ta" ? "Kore" : "Charon") : "");
      sel.dataset.engine = engine;
    });
    $("voice-hint").textContent = engine === "gemini"
      ? "Gemini voices sound natural and speak both English and Tamil. They need internet and use Gemini's free daily voice limit; if it runs out, Jo uses the PC voice."
      : "PC voices are instant and work offline. For Tamil, Microsoft Edge includes good voices (Pallavi, Valluvar).";
  }

  // ---------- speech in ----------
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  function listen() {
    if (rec) { rec.stop(); return; }
    if (!Recognition) { toast("Voice input needs Chrome or Edge. You can still type."); return; }
    stopSpeaking();
    rec = new Recognition();
    rec.lang = settings.tamil ? "ta-IN" : "en-IN";
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let finalText = "";
    const input = $("ask-input");
    rec.onstart = () => { setState("listening"); $("mic").classList.add("live"); };
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript; else interim += e.results[i][0].transcript;
      }
      input.value = (finalText + interim).trim();
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed") toast("Microphone blocked. Allow it in the address bar to talk to Jo.");
      else if (e.error !== "no-speech" && e.error !== "aborted") toast(`Voice error: ${e.error}`);
    };
    rec.onend = () => {
      rec = null; $("mic").classList.remove("live");
      const text = finalText.trim();
      if (text) { input.value = ""; ask(text); } else setState("idle");
    };
    rec.start();
  }

  // ---------- asking Jo ----------
  let busy = false;
  async function ask(text) {
    text = text.trim();
    if (!text || busy) return;
    addMsg("me", text);
    const a = getAgent();
    if (!a) { addMsg("jo", "Please add your Gemini API key in Settings first.", { error: true }); openSettings(); return; }
    busy = true;
    setState("thinking");
    const used = [];
    try {
      const reply = await a.ask(text, (tool) => { used.push(tool); setState("thinking", TOOL_LABELS[tool] || "PROCESSING…"); });
      addMsg("jo", reply, { tools: used });
      renderTasks(); renderAgenda();
      speak(reply);
    } catch (e) {
      addMsg("jo", e.message, { error: true });
      setState("error", "ERROR · SEE MESSAGE"); setTimeout(() => setState("idle"), 3000);
    } finally { busy = false; }
  }

  async function makeBrief(auto = false) {
    const a = getAgent();
    if (!a) { if (!auto) { addMsg("jo", "Please add your Gemini API key in Settings first.", { error: true }); openSettings(); } return; }
    if (busy) return;
    busy = true;
    setState("thinking", "COMPILING MORNING BRIEF");
    try {
      const text = await a.morningBrief();
      storage.setItem("jo.brief", JSON.stringify({ date: isoDate(), text, played: false }));
      addMsg("jo", text);
      if (!auto || navigator.userActivation?.hasBeenActive) { speak(text); markBriefPlayed(); }
      else { $("brief-banner").hidden = false; setState("idle"); notify("Your morning brief is ready", "Click to listen", () => { window.focus(); playBrief(); }); }
    } catch (e) {
      addMsg("jo", `Morning brief failed: ${e.message}`, { error: true });
      setState("idle");
    } finally { busy = false; }
  }
  const markBriefPlayed = () => { const b = readJson("jo.brief", null); if (b) { b.played = true; storage.setItem("jo.brief", JSON.stringify(b)); } $("brief-banner").hidden = true; };
  function playBrief() { const b = readJson("jo.brief", null); if (b?.text) speak(b.text, { force: true }); markBriefPlayed(); }

  // ---------- panels ----------
  function renderSystems() {
    const configured = {
      gemini: !!settings.geminiKey, mail: !!(settings.bridgeUrl && settings.bridgeKey), calendar: !!(settings.bridgeUrl && settings.bridgeKey),
      kavery: !!buildTools().kavery, thirumal: !!buildTools().thirumal,
      gtasks: !!buildTools().google,
    };
    const rows = [["gemini", "Gemini AI core"], ["mail", "Zoho Mail"], ["kavery", "Kavery Delivery"], ["thirumal", "Thirumal accounts"], ["calendar", "Google Calendar"], ["gtasks", "Google Tasks"]];
    $("systems").innerHTML = rows.map(([k, label]) => {
      const st = !configured[k] ? "off" : health[k] === "err" ? "err" : "ok";
      const val = { off: "OFFLINE", err: "FAULT", ok: health[k] === "ok" ? "ONLINE" : "READY" }[st];
      return `<li class="${st}"><span class="dot"></span><span class="name">${label}</span><span class="val">${val}</span></li>`;
    }).join("");
  }

  // Last task list shown (Google Tasks or Jo's local list); reminders use it too.
  let shownTasks = [];
  let tasksBusy = false;
  async function renderTasks() {
    if (tasksBusy) return;
    tasksBusy = true;
    const tools = buildTools();
    try {
      shownTasks = (await tools.taskList(true)).filter((t) => t.kind !== "event" || !t.done).slice(0, 40);
      if (tools.google) setHealth("gtasks", "ok");
    } catch (e) {
      if (tools.google) setHealth("gtasks", "err");
      $("tasks").innerHTML = `<li class="muted">${esc(e.message)}</li>`;
      tasksBusy = false;
      return;
    }
    tasksBusy = false;
    const soon = Date.now() + 2 * 3600000;
    const when = (t) => {
      if (!t.due) return "";
      if (t.source === "google" && !t.remindAt) return new Date(t.due).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
      return formatTime(t.due);
    };
    $("tasks").innerHTML = shownTasks.length ? shownTasks.map((t) => `
      <li class="${t.done ? "done" : ""}" data-id="${esc(t.id)}" data-src="${t.source || "jo"}">
        <input type="checkbox" ${t.done ? "checked" : ""} aria-label="Done">
        <div class="t">${t.kind === "event" ? "📅 " : ""}${esc(t.title)}${t.source === "google" ? '<span class="g-tag" title="Saved in Google Tasks">G</span>' : ""}${
          t.due ? `<div class="due${!t.done && t.due < soon ? " soon" : ""}">${esc(when(t))}</div>` : ""}</div>
        <button class="del" aria-label="Delete">✕</button>
      </li>`).join("") : `<li class="muted">No tasks. Say "remind me to…"</li>`;
  }

  let agendaBusy = false;
  async function renderAgenda() {
    if (agendaBusy) return;
    agendaBusy = true;
    try {
      const { list, note } = await buildTools().events(2);
      const today = startOfToday(), tomorrow = today + 86400000;
      const item = (e) => {
        const when = e.allDay ? "ALL DAY" : new Date(e.start).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }).toUpperCase();
        const day = e.start >= tomorrow ? "TMRW " : "";
        return `<li><span class="when">${day}${esc(when)}</span><span><span class="what">${esc(e.title)}</span>${e.jo ? '<span class="jo-tag">JO</span>' : ""}${
          e.location ? `<div class="where">${esc(e.location)}</div>` : ""}</span></li>`;
      };
      const upcoming = list.filter((e) => e.end > Date.now() || e.allDay);
      $("agenda").innerHTML = (upcoming.length ? upcoming.map(item).join("") : `<li class="muted">Nothing scheduled today or tomorrow.</li>`) +
        (note ? `<li class="muted">${esc(note)}</li>` : "");
      if (settings.bridgeUrl) setHealth("calendar", note ? "err" : "ok");
    } finally { agendaBusy = false; }
  }

  function tickClock() {
    const d = new Date();
    $("clock-time").textContent = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
    $("clock-date").textContent = d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }

  // ---------- notifications, reminders, brief schedule ----------
  function notify(title, body, onClick) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const n = new Notification(title, { body, tag: title });
    if (onClick) n.onclick = onClick;
  }
  function toast(text) {
    const t = $("toast"); t.textContent = text; t.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 5000);
  }

  function checkReminders() {
    const fired = new Set(readJson("jo.fired", []));
    const now = Date.now();
    // Google tasks only remind when Jo set a time ("Jo reminder: …" in the notes).
    const due = [...tasks.open(), ...shownTasks.filter((t) => t.source === "google" && !t.done && t.remindAt)];
    for (const t of due) {
      if (!t.due || fired.has(t.id) || t.due > now || t.due < now - 6 * 3600000) continue;
      fired.add(t.id);
      const text = `Reminder: ${t.title}`;
      notify("Jo reminder", t.title);
      toast(text);
      addMsg("jo", text);
      if (navigator.userActivation?.hasBeenActive && !busy) speak(text, { quick: true });
    }
    storage.setItem("jo.fired", JSON.stringify([...fired].slice(-200)));
  }

  function checkBrief() {
    if (!settings.briefEnabled || !settings.geminiKey) return;
    const [h, m] = (settings.briefTime || "08:00").split(":").map(Number);
    const due = new Date(); due.setHours(h, m, 0, 0);
    const last = readJson("jo.brief", null);
    if (Date.now() >= due.getTime() && last?.date !== isoDate()) makeBrief(true);
    else if (last?.date === isoDate() && !last.played) $("brief-banner").hidden = false;
  }

  // ---------- new-mail watch (all Zoho folders, via the bridge) ----------
  let mailTimer = null, mailBusy = false;
  async function checkMail() {
    const bridge = buildTools().bridge;
    if (!bridge) { $("mail").innerHTML = '<li class="muted">Zoho Mail not connected.</li>'; $("mail-count").textContent = ""; return; }
    if (mailBusy) return;
    mailBusy = true;
    try {
      const { mails } = await bridge.call("zoho_unread", { limit: 30 });
      setHealth("mail", "ok");
      const stored = readJson("jo.mailSeen", null);
      const seen = new Set(stored || []);
      const fresh = mails.filter((m) => !seen.has(m.messageId));
      mails.forEach((m) => seen.add(m.messageId));
      storage.setItem("jo.mailSeen", JSON.stringify([...seen].slice(-500)));
      renderMail(mails, new Set(fresh.map((m) => m.messageId)));
      // The first check only learns what's already there, so Jo doesn't announce old mail.
      if (stored && fresh.length) announceMail(fresh);
    } catch (e) {
      setHealth("mail", "err");
      $("mail").innerHTML = `<li class="muted">${esc(e.message)}</li>`;
    } finally { mailBusy = false; }
  }

  function renderMail(mails, freshIds) {
    $("mail-count").textContent = mails.length ? `${mails.length}${mails.length >= 30 ? "+" : ""} UNREAD` : "";
    $("mail").innerHTML = mails.length ? mails.slice(0, 6).map((m) => `
      <li class="${freshIds.has(m.messageId) ? "fresh" : ""}" data-from="${esc(m.from)}" data-subject="${esc(m.subject)}" title="Ask Jo to read this email">
        <div class="from">${esc(m.from)}</div>
        <div class="subj">${esc(m.subject || "(no subject)")}</div>
        <div class="meta">${m.folder ? `<span class="folder">${esc(m.folder.toUpperCase())}</span>` : ""}${esc(m.received ? formatAgo(m.received) : "")}</div>
      </li>`).join("") : '<li class="muted">No unread mail. All clear.</li>';
  }

  function announceMail(fresh) {
    fresh.slice(0, 3).forEach((m) => {
      const where = m.folder ? ` in ${m.folder}` : "";
      notify(`New email${where}`, `${m.from}: ${m.subject}`, () => window.focus());
      addMsg("jo", `New email${where} from ${m.from}: ${m.subject}`);
    });
    if (fresh.length > 3) addMsg("jo", `…and ${fresh.length - 3} more new emails.`);
    const latest = fresh[0];
    const line = fresh.length === 1
      ? `New email from ${latest.from}${latest.folder ? `, in ${latest.folder}` : ""}: ${latest.subject}`
      : `You have ${fresh.length} new emails. The latest is from ${latest.from}: ${latest.subject}`;
    toast(line);
    if (settings.announceMail && navigator.userActivation?.hasBeenActive && !busy && !isSpeaking() && !rec) speak(line, { quick: true });
  }

  function scheduleMail() {
    clearInterval(mailTimer);
    const minutes = Number(settings.mailCheckMinutes) || 0;
    if (minutes > 0 && settings.bridgeUrl && settings.bridgeKey) mailTimer = setInterval(checkMail, Math.max(minutes, 1) * 60000);
  }

  // ---------- settings drawer ----------
  const field = (path) => path.split(".").reduce((o, k) => o?.[k], settings);
  const setField = (path, v) => { const keys = path.split("."), last = keys.pop(); keys.reduce((o, k) => o[k], settings)[last] = v; };
  function openSettings() {
    document.querySelectorAll("[data-setting]").forEach((el) => {
      const v = field(el.dataset.setting);
      if (el.type === "checkbox") el.checked = !!v; else el.value = v ?? "";
    });
    fillVoiceSelects();
    $("settings").hidden = false; $("drawer-backdrop").hidden = false;
  }
  function closeSettings() { $("settings").hidden = true; $("drawer-backdrop").hidden = true; }
  let removedSecret = false;
  function collectSettings() {
    document.querySelectorAll("[data-setting]").forEach((el) => setField(el.dataset.setting,
      el.type === "checkbox" ? el.checked : el.type === "number" ? Math.max(0, Number(el.value) || 0) : el.value.trim()));
    if (!settings.geminiModel) settings.geminiModel = DEFAULT_MODEL;
    const engine = $("voice-engine").value;
    if (engine === "gemini") { settings.geminiVoiceEn = $("voice-en").value; settings.geminiVoiceTa = $("voice-ta").value; }
    else { settings.pcVoiceEn = $("voice-en").value; settings.pcVoiceTa = $("voice-ta").value; }
    ["kavery", "thirumal"].forEach((k) => {
      if (/^sb_secret_/.test(settings[k].key)) { settings[k].key = ""; removedSecret = true; }
    });
    saveSettings();
    agent = null;
    renderSystems();
    scheduleMail();
  }

  async function runTest(kind) {
    collectSettings();
    const out = $("test-out");
    out.textContent = `Testing ${kind}…`;
    const tools = buildTools();
    try {
      let result;
      switch (kind) {
        case "gemini":
          result = Gemini.text(await new Gemini(settings.geminiKey, settings.geminiModel).generate("Reply in under ten words.", [Gemini.userText("Say hello to Karthik.")]));
          setHealth("gemini", "ok"); break;
        case "bridge": {
          if (!tools.bridge) throw new Error("Fill in the bridge URL and key first.");
          await tools.bridge.call("ping");
          const parts = [];
          try { const { mails } = await tools.bridge.call("zoho_recent", { limit: 3 }); parts.push(`Mail OK: ${mails.length} recent emails`); setHealth("mail", "ok"); }
          catch (e) { parts.push(`Mail: ${e.message}`); setHealth("mail", "err"); }
          try { const { events } = await tools.bridge.call("calendar", { from: startOfToday(), to: startOfToday() + 7 * 86400000 }); parts.push(`Calendar OK: ${events.length} events this week`); setHealth("calendar", "ok"); }
          catch (e) { parts.push(`Calendar: ${e.message}`); setHealth("calendar", "err"); }
          result = parts.join("\n"); break;
        }
        case "zoho-connect": {
          if (!tools.bridge) throw new Error("Fill in the bridge URL and key first.");
          const code = $("zoho-code").value.trim();
          if (!code) throw new Error("Paste the Zoho grant code first.");
          await tools.bridge.call("zoho_connect", { code });
          $("zoho-code").value = "";
          setHealth("mail", "ok");
          checkMail();
          result = "Zoho Mail connected."; break;
        }
        case "google": {
          if (!tools.bridge) throw new Error("Fill in the bridge URL and key first.");
          const { connected } = await tools.bridge.call("google_status");
          settings.googleConnected = connected; saveSettings();
          if (!connected) throw new Error("Not connected yet. Click Connect Google.");
          const list = await new GoogleWorkspace(tools.bridge).tasks();
          setHealth("gtasks", "ok");
          result = `Google connected: ${list.length} open tasks in Google Tasks.`; break;
        }
        case "kavery": case "thirumal": {
          const src = tools[kind];
          if (!src) throw new Error(settings[kind].viaBridge !== false ? "Fill in the Jo bridge URL and key first." : "Fill in the project URL and key first.");
          result = await src.summary();
          setHealth(kind, "ok"); break;
        }
      }
      out.textContent = `✔ ${kind}\n${String(result).slice(0, 900)}`;
    } catch (e) {
      out.textContent = `✖ ${kind}: ${e.message}`;
      const map = { gemini: "gemini", bridge: "mail", "zoho-connect": "mail", kavery: "kavery", thirumal: "thirumal", google: "gtasks" };
      setHealth(map[kind], "err");
    }
  }

  // ---------- wiring ----------
  function setLang(tamil) {
    settings.tamil = tamil; saveSettings(); agent = null;
    $("lang-en").classList.toggle("on", !tamil); $("lang-ta").classList.toggle("on", tamil);
    document.documentElement.lang = tamil ? "ta" : "en";
  }
  function renderMute() {
    $("mute").innerHTML = settings.speak
      ? '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M16.5 12A4.5 4.5 0 0 0 14 8v2.2l2.5 2.5zM19 12a7 7 0 0 1-.6 2.8l1.5 1.5A9 9 0 0 0 14 3.2v2.1A7 7 0 0 1 19 12zM4.3 3 3 4.3 7.7 9H3v6h4l5 5v-6.7l4.3 4.3a7 7 0 0 1-2.3 1.2v2.1a9 9 0 0 0 3.7-1.9l2 2L21 20.7zM12 4 9.9 6.1 12 8.2z"/></svg>';
  }

  reactor.addEventListener("click", listen);
  $("mic").addEventListener("click", listen);
  $("ask-form").addEventListener("submit", (e) => { e.preventDefault(); const v = $("ask-input").value; $("ask-input").value = ""; ask(v); });
  document.addEventListener("keydown", (e) => {
    const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName);
    if (e.code === "Space" && !typing && $("settings").hidden) { e.preventDefault(); listen(); }
    if (e.key === "Escape") { if (!$("settings").hidden) closeSettings(); else { stopSpeaking(); setState("idle"); } }
  });
  $("quick").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.hasAttribute("data-brief")) makeBrief(false); else ask(b.dataset.ask);
  });
  $("play-brief").addEventListener("click", playBrief);
  $("dismiss-brief").addEventListener("click", markBriefPlayed);
  $("lang-en").addEventListener("click", () => setLang(false));
  $("lang-ta").addEventListener("click", () => setLang(true));
  $("mute").addEventListener("click", () => { settings.speak = !settings.speak; saveSettings(); renderMute(); if (!settings.speak) { stopSpeaking(); setState("idle"); } });
  $("open-settings").addEventListener("click", openSettings);
  $("close-settings").addEventListener("click", closeSettings);
  $("drawer-backdrop").addEventListener("click", closeSettings);
  $("save-settings").addEventListener("click", () => {
    collectSettings();
    $("test-out").textContent = removedSecret
      ? "Saved. A Supabase secret key was removed from this browser (Supabase blocks them here); the bridge holds it instead."
      : "Saved.";
    removedSecret = false;
    renderAgenda(); checkMail();
  });
  document.querySelectorAll("[data-test]").forEach((b) => b.addEventListener("click", () => runTest(b.dataset.test)));
  $("refresh-agenda").addEventListener("click", renderAgenda);
  $("voice-engine").addEventListener("change", fillVoiceSelects);
  $("connect-google").addEventListener("click", connectGoogle);
  document.querySelectorAll("[data-preview]").forEach((b) => b.addEventListener("click", () => {
    const lang = b.dataset.preview;
    speak(SAMPLE[lang], { lang, engine: $("voice-engine").value, voice: $(`voice-${lang}`).value, force: true });
  }));
  $("refresh-mail").addEventListener("click", checkMail);
  $("mail").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-from]"); if (!li) return;
    ask(`Read me the email from ${li.dataset.from} with subject "${li.dataset.subject}".`);
  });

  $("add-task").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("task-title").value.trim(); if (!title) return;
    const due = $("task-due").value ? new Date($("task-due").value).getTime() : null;
    $("task-title").value = ""; $("task-due").value = "";
    const google = buildTools().google;
    try {
      if (google) { await google.addTask(title, due); toast("Added to Google Tasks."); } else tasks.add(title, due);
    } catch (err) { toast(err.message); }
    renderTasks(); renderAgenda();
  });
  $("tasks").addEventListener("click", async (e) => {
    const li = e.target.closest("li[data-id]"); if (!li) return;
    const id = li.dataset.id, google = li.dataset.src === "google" ? buildTools().google : null;
    try {
      if (e.target.matches("input[type=checkbox]")) { if (google) await google.setDone(id, e.target.checked); else tasks.setDone(id, e.target.checked); }
      else if (e.target.matches(".del")) { if (google) await google.remove(id); else tasks.remove(id); }
      else return;
    } catch (err) { toast(err.message); }
    renderTasks(); renderAgenda();
  });

  // ---------- Google sign-in (the bridge keeps the login) ----------
  const redirectUri = () => location.origin + location.pathname;
  async function connectGoogle() {
    collectSettings();
    const bridge = buildTools().bridge;
    if (!bridge) { $("test-out").textContent = "✖ Fill in the Jo bridge URL and key first."; return; }
    if (location.protocol === "file:") { $("test-out").textContent = "✖ Open Jo from its website (github.io) to connect Google."; return; }
    try {
      const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem("jo.googleState", state);
      const { url } = await bridge.call("google_auth_url", { redirectUri: redirectUri(), state });
      location.href = url;
    } catch (err) { $("test-out").textContent = `✖ google: ${err.message}`; }
  }
  async function finishGoogleSignIn() {
    const q = new URLSearchParams(location.search);
    if (!q.has("state") || (!q.has("code") && !q.has("error"))) return;
    history.replaceState(null, "", redirectUri()); // remove the one-time code from the address bar
    let expected = null;
    try { expected = sessionStorage.getItem("jo.googleState"); sessionStorage.removeItem("jo.googleState"); } catch { /* ignore */ }
    if (q.get("error")) { toast(`Google sign-in was cancelled (${q.get("error")}).`); return; }
    if (!expected || q.get("state") !== expected) { toast("Google sign-in didn't match this browser. Please try Connect Google again."); return; }
    const bridge = buildTools().bridge;
    if (!bridge) return;
    try {
      await bridge.call("google_connect", { code: q.get("code"), redirectUri: redirectUri() });
      settings.googleConnected = true; saveSettings(); agent = null;
      setHealth("gtasks", "ok");
      toast("Google connected. New tasks go to Google Tasks and events to Google Calendar.");
      addMsg("jo", "Google is connected. I'll save your tasks in Google Tasks and your meetings in Google Calendar.");
      renderTasks(); renderAgenda();
    } catch (err) { toast(`Google connect failed: ${err.message}`); }
  }

  // Ask for notification permission on the first click anywhere (browsers require a gesture).
  document.addEventListener("click", function once() {
    document.removeEventListener("click", once);
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  });

  // ---------- start ----------
  setLang(settings.tamil); renderMute(); renderSystems(); renderTasks(); tickClock(); setState("idle");
  addMsg("jo", settings.geminiKey
    ? (settings.tamil ? "வணக்கம் கார்த்திக். நான் தயார்." : "Good to see you, Karthik. All systems ready. What do you need?")
    : "Welcome, Karthik. Open Settings (the gear, top right) and add your free Gemini key to bring me online.");
  renderAgenda();
  setInterval(tickClock, 1000 * 15);
  setInterval(checkReminders, 30000);
  setInterval(checkBrief, 60000);
  setInterval(renderAgenda, 10 * 60000);
  setInterval(renderTasks, 5 * 60000); // picks up tasks added in Google Tasks elsewhere
  checkReminders(); checkBrief();
  checkMail(); scheduleMail();
  finishGoogleSignIn();
})();
