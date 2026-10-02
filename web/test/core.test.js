// Run: node --test web/test/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const Jo = require("../jo-core.js");

const memoryStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
const json = (d, status = 200, headers = {}) => new Response(JSON.stringify(d), { status, headers });

test("Gemini tool loop echoes thought signatures and runs add_task", async () => {
  const sent = [];
  const replies = [
    { candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "add_task", args: { title: "Call supplier", due: "2026-10-02 17:00" } }, thoughtSignature: "sig1" }] } }] },
    { candidates: [{ content: { role: "model", parts: [{ text: "Added, I'll remind you at 5 PM." }] } }] },
  ];
  const http = async (url, init) => { sent.push({ url, init, body: JSON.parse(init.body) }); return json(replies.shift()); };
  const tasks = new Jo.TaskStore(memoryStorage());
  const agent = new Jo.Agent(new Jo.Gemini("KEY", "gemini-flash-latest", http), new Jo.Tools({ tasks }));
  assert.equal(await agent.ask("remind me to call supplier tomorrow 5pm"), "Added, I'll remind you at 5 PM.");
  assert.equal(sent[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent");
  assert.equal(sent[0].init.headers["x-goog-api-key"], "KEY");
  assert.ok(sent[0].body.tools[0].functionDeclarations.length >= 12);
  const c = sent[1].body.contents;
  assert.equal(c.length, 3);
  assert.equal(c[1].parts[0].thoughtSignature, "sig1");
  assert.match(c[2].parts[0].functionResponse.response.result, /^Added/);
  const [t] = tasks.open();
  assert.equal(t.title, "Call supplier");
  assert.equal(new Date(t.due).getHours(), 17);
});

test("Gemini speech asks for audio with the chosen voice and reads the sample rate", async () => {
  let sent;
  const http = async (url, init) => {
    sent = { url, body: JSON.parse(init.body) };
    return json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: "AAEC" } }] } }] });
  };
  const g = new Jo.Gemini("k", "gemini-flash-latest", http);
  const audio = await g.speech("வணக்கம்", "Kore");
  assert.deepEqual(audio, { data: "AAEC", rate: 24000 });
  assert.match(sent.url, /\/gemini-2\.5-flash-preview-tts:generateContent$/);
  assert.deepEqual(sent.body.generationConfig.responseModalities, ["AUDIO"]);
  assert.equal(sent.body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Kore");
  assert.equal(sent.body.contents[0].parts[0].text, "வணக்கம்");
  const limited = new Jo.Gemini("k", "m", async () => json({}, 429));
  await assert.rejects(limited.speech("hi", "Puck"), /daily limit/);
  assert.ok(Jo.GEMINI_VOICES.length >= 30);
});

test("Gemini retries 503, then falls back to the lite model", async () => {
  const urls = [];
  const statuses = [503, 503, 503, 200];
  const http = async (url) => {
    urls.push(url);
    const status = statuses.shift();
    return status === 200
      ? json({ candidates: [{ content: { role: "model", parts: [{ text: "Hello Karthik" }] } }] })
      : json({ error: { message: "The model is overloaded." } }, status);
  };
  const g = new Jo.Gemini("k", "gemini-flash-latest", http);
  const waits = [];
  g.sleep = async (ms) => { waits.push(ms); };
  const reply = await g.generate("s", [Jo.Gemini.userText("hi")]);
  assert.equal(Jo.Gemini.text(reply), "Hello Karthik");
  assert.deepEqual(waits, [1500, 4000]);
  assert.equal(urls.filter((u) => u.includes("/gemini-flash-latest:")).length, 3);
  assert.match(urls.at(-1), /\/gemini-flash-lite-latest:generateContent$/);
});

test("Gemini busy everywhere gives a clear message; 429 tries the fallback once", async () => {
  const g = new Jo.Gemini("k", "m", async () => json({}, 503));
  g.sleep = async () => {};
  await assert.rejects(g.generate("s", []), /servers are busy/);

  const urls = [];
  const q = new Jo.Gemini("k", "gemini-flash-latest", async (url) => { urls.push(url); return json({ error: { message: "quota" } }, 429); });
  q.sleep = async () => {};
  await assert.rejects(q.generate("s", []), /free-tier limit/);
  assert.equal(urls.length, 2); // main model once, fallback once, no retries

  const bad = new Jo.Gemini("k", "m", async () => json({ error: { message: "API key not valid. Please pass a valid API key." } }, 400));
  await assert.rejects(bad.generate("s", []), /API key is not valid/);
  const badModel = new Jo.Gemini("k", "m", async () => json({ error: { message: "Invalid model" } }, 400));
  await assert.rejects(badModel.generate("s", []), /rejected the request/);
});

test("Unknown model name falls back to the standard model", async () => {
  const urls = [];
  const g = new Jo.Gemini("k", "gemini-flash-lite-lates", async (url) => {
    urls.push(url);
    return url.includes("/gemini-flash-lite-lates:") ? json({ error: { message: "not found" } }, 404)
      : json({ candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }] });
  });
  assert.equal(Jo.Gemini.text(await g.generate("s", [])), "ok");
  assert.match(urls[1], /\/gemini-flash-latest:generateContent$/);
});

test("Supabase summary, describe and query with sb_ secret key", async () => {
  const seen = [];
  const http = async (url, init = {}) => {
    seen.push({ url, headers: init.headers || {} });
    const u = new URL(url);
    if (u.pathname === "/rest/v1/orders" && u.searchParams.get("order") === "created_at.desc") return json([{ id: 1, status: "pending" }], 200, { "Content-Range": "0-0/57" });
    if (u.pathname === "/rest/v1/orders") return json([{ id: 1, status: "pending" }], 200, { "Content-Range": "0-0/9" });
    if (u.pathname === "/rest/v1/riders" && u.searchParams.has("order")) return json({ message: "no created_at" }, 400);
    if (u.pathname === "/rest/v1/riders") return json([{ name: "Ravi" }], 200, { "Content-Range": "0-0/4" });
    if (u.pathname === "/rest/v1/rpc/jo_lookup") { assert.deepEqual(JSON.parse(init.body), { p_search: "murugan", p_from: "2026-09-01", p_to: null }); return json({ matching_invoices: 3, due: 1200 }); }
    if (u.pathname === "/rest/v1/rpc/jo_daily_summary") { assert.equal(init.body, '{"p_date":"2026-10-01"}'); return json({ orders: 14 }); }
    return json({}, 404);
  };
  const s = new Jo.Supabase("Kavery", { url: "https://p.supabase.co/", key: "sb_secret_x", tables: "orders, riders" }, http);
  const sum = await s.summary();
  assert.match(sum, /Table orders: 57 rows/);
  assert.match(sum, /Table riders: 4 rows/);
  assert.equal(seen[0].headers.apikey, "sb_secret_x");
  assert.equal(seen[0].headers.Authorization, undefined);
  assert.equal(await s.describe(), "- orders: id, status\n- riders: name");
  const q = await s.query("orders", "id,status", "status=eq.pending&limit=999", "id.desc", 10);
  assert.match(q, /^Total matching rows: 9/);
  const last = new URL(seen.at(-1).url);
  assert.equal(last.searchParams.get("status"), "eq.pending");
  assert.equal(last.searchParams.get("limit"), "10");
  await assert.rejects(s.query("users"), /not in the allowed list/);
  const rpc = new Jo.Supabase("Kavery", { url: "https://p.supabase.co", key: "eyJabc", fn: "jo_daily_summary", lookupFn: "jo_lookup" }, http);
  assert.equal(await rpc.summary("2026-10-01"), '{"orders":14}');
  assert.equal(seen.at(-1).headers.Authorization, "Bearer eyJabc");
  assert.equal(await rpc.lookup("murugan", "2026-09-01"), '{"matching_invoices":3,"due":1200}');
  await assert.rejects(s.lookup("x"), /No lookup function set/);
  // Spaces in the function name are turned into underscores; a public key gets a clear message.
  const spaced = new Jo.Supabase("Kavery", { url: "https://p.supabase.co", key: "eyJabc", fn: " jo daily summary " }, http);
  assert.equal(await spaced.summary("2026-10-01"), '{"orders":14}');
  const denied = new Jo.Supabase("Kavery", { url: "https://p.supabase.co", key: "sb_publishable_x", fn: "jo_daily_summary" },
    async () => json({ message: "permission denied" }, 401));
  await assert.rejects(denied.summary(), /needs? the project's SECRET key/);
});

test("Tools: mail via bridge, events merge, missing sources", async () => {
  const calls = [];
  const http = async (url, init) => {
    const b = JSON.parse(init.body); calls.push(b);
    assert.equal(init.headers["x-jo-key"], "bk");
    if (b.action === "zoho_unread") return json({ mails: [{ messageId: "m1", folderId: "f1", from: "Bank", subject: "GST due", summary: "Pay by 20th", received: 0, unread: true }] });
    if (b.action === "zoho_read") return json({ content: "<div>Hello<br>Total: <b>4,20,000</b></div>" });
    if (b.action === "calendar") return json({ events: [{ title: "Britannia rep", start: b.from + 11 * 3600000, end: b.from + 12 * 3600000, allDay: false, location: "Office" }] });
    return json({ error: "bad" }, 400);
  };
  const tasks = new Jo.TaskStore(memoryStorage());
  const tools = new Jo.Tools({ bridge: new Jo.Bridge("https://p.supabase.co/functions/v1/jo-bridge", "bk", http), tasks });
  assert.match(await tools.call("get_unread_mail"), /UNREAD .*GST due/);
  assert.equal(await tools.call("read_mail", { folder_id: "f1", message_id: "m1" }), "Hello\nTotal: 4,20,000");
  const today = Jo.isoDate();
  assert.match(await tools.call("add_event", { title: "Dentist", start: `${today} 18:00` }), /Added to Jo's agenda/);
  const ev = await tools.call("list_events", { days: 1 });
  assert.ok(ev.indexOf("Britannia rep") < ev.indexOf("Dentist"), ev);
  assert.match(await tools.call("get_app_summary", { app: "kavery" }), /Kavery is not connected/);
  const brief = await tools.briefData();
  assert.match(brief, /## Kavery Delivery\nNot connected\./);
  const noBridge = new Jo.Tools({ tasks });
  assert.match(await noBridge.call("get_unread_mail"), /Zoho Mail is not connected/);
});

test("BridgeApp reads Kavery/Thirumal through the bridge", async () => {
  const sent = [];
  const http = async (url, init) => {
    const b = JSON.parse(init.body); sent.push(b);
    if (b.action === "app_summary") return json({ result: '{"orders_on_date":14}' });
    if (b.action === "app_lookup") return json({ result: '{"matching_orders":3}' });
    return json({ error: "x" }, 400);
  };
  const bridge = new Jo.Bridge("https://p.supabase.co/functions/v1/smooth-api", "bk", http);
  const tools = new Jo.Tools({ kavery: new Jo.BridgeApp("Kavery Delivery", "kavery", bridge), tasks: new Jo.TaskStore(memoryStorage()) });
  assert.equal(await tools.call("get_app_summary", { app: "kavery", date: "2026-10-01" }), '{"orders_on_date":14}');
  assert.equal(await tools.call("search_app_records", { app: "kavery", search: "murugan" }), '{"matching_orders":3}');
  assert.deepEqual(sent, [
    { action: "app_summary", app: "kavery", date: "2026-10-01" },
    { action: "app_lookup", app: "kavery", search: "murugan", from: null, to: null },
  ]);
  assert.match(await tools.call("query_app_data", { app: "kavery", table: "orders" }), /use search_app_records/);
  const old = new Jo.BridgeApp("Kavery", "kavery", new Jo.Bridge("u", "k", async () => json({ error: "Unknown action app_summary" }, 400)));
  await assert.rejects(old.summary(), /older version/);
});

test("Google Tasks and Calendar through the bridge", async () => {
  const calls = [];
  const remote = [];
  const http = async (url, init) => {
    const b = JSON.parse(init.body); calls.push(b);
    if (b.action === "gtasks_add") { const t = { id: "g" + remote.length, title: b.title, due: b.due, notes: b.notes, done: false }; remote.push(t); return json({ task: t }); }
    if (b.action === "gtasks_list") return json({ tasks: remote });
    if (b.action === "gtasks_update") { const t = remote.find((x) => x.id === b.id); t.done = b.done; return json({ task: t }); }
    if (b.action === "gtasks_delete") return json({ deleted: true });
    if (b.action === "gcal_list") return json({ events: [{ title: "Britannia rep", start: b.from + 11 * 3600000, end: b.from + 12 * 3600000, allDay: false, location: "" }] });
    if (b.action === "gcal_add") return json({ event: { title: b.title, start: b.start, end: b.end } });
    return json({ error: "x" }, 400);
  };
  const bridge = new Jo.Bridge("u", "k", http);
  const local = new Jo.TaskStore(memoryStorage());
  const tools = new Jo.Tools({ bridge, tasks: local, google: new Jo.GoogleWorkspace(bridge) });
  assert.match(await tools.call("add_task", { title: "Call supplier", due: "2026-10-01 17:00" }), /Added to Google Tasks: .*Call supplier/);
  const add = calls.find((c) => c.action === "gtasks_add");
  assert.equal(add.due, "2026-10-01T00:00:00.000Z");
  assert.equal(add.notes, "Jo reminder: 2026-10-01 17:00");
  assert.equal(local.all().length, 0, "nothing stored only in the browser");
  const [t] = await tools.taskList();
  assert.equal(new Date(t.remindAt).getHours(), 17);
  assert.match(await tools.call("list_tasks"), /Call supplier \(.*5:00/);
  assert.match(await tools.call("complete_task", { task_id: "g0" }), /Done in Google Tasks: Call supplier/);
  assert.match(await tools.call("delete_task", { task_id: "g0" }), /Deleted from Google Tasks/);
  assert.match(await tools.call("add_event", { title: "Dentist", start: "2026-10-02 18:00" }), /Added to Google Calendar/);
  const ev = calls.find((c) => c.action === "gcal_add");
  assert.equal(ev.end - ev.start, 3600000);
  assert.ok(ev.timeZone);
  assert.match(await tools.call("list_events", { days: 1 }), /Britannia rep/);
  assert.ok(!calls.some((c) => c.action === "calendar"), "uses Google Calendar API, not the iCal link");
});

test("TaskStore ordering, done and delete", () => {
  const s = new Jo.TaskStore(memoryStorage());
  const a = s.add("A"); const b = s.add("B", Jo.parseLocal("2026-10-02 09:30"));
  assert.deepEqual(s.open().map((t) => t.title), ["B", "A"]);
  s.setDone(b.id); assert.deepEqual(s.open().map((t) => t.title), ["A"]);
  assert.ok(s.remove(a.id)); assert.equal(s.all().length, 1);
  assert.throws(() => Jo.parseLocal("tomorrow"), /Bad date/);
});

test("matchWake finds Jo and keeps the command after the name", () => {
  assert.deepEqual(Jo.matchWake("Jo"), { command: "" });
  assert.deepEqual(Jo.matchWake("hey Joe, check my mail"), { command: "check my mail" });
  assert.deepEqual(Jo.matchWake("okay jo what's on today"), { command: "what's on today" });
  assert.deepEqual(Jo.matchWake("ஜோ இன்றைய வேலைகள்"), { command: "இன்றைய வேலைகள்" });
  assert.equal(Jo.matchWake("I need a job done"), null);
  assert.equal(Jo.matchWake("Joseph called"), null);
  assert.equal(Jo.matchWake("major update"), null);
  assert.equal(Jo.matchWake(""), null);
});

test("web_search asks Gemini with Google Search grounding and returns the answer with sources", async () => {
  const sent = [];
  const replies = [
    // Jo decides to search
    { candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "web_search", args: { query: "Chennai weather today" } } }] } }] },
    // the grounded search call
    { candidates: [{ content: { role: "model", parts: [{ text: "Chennai: 33°C, light rain in the evening." }] },
      groundingMetadata: { groundingChunks: [
        { web: { uri: "https://vertexaisearch.example/1", title: "imd.gov.in" } },
        { web: { uri: "https://vertexaisearch.example/2", title: "imd.gov.in" } },
        { web: { uri: "https://vertexaisearch.example/3", title: "thehindu.com" } },
      ] } }] },
    // Jo's spoken reply
    { candidates: [{ content: { role: "model", parts: [{ text: "It's 33 degrees in Chennai, with light rain this evening, says IMD." }] } }] },
  ];
  const http = async (url, init) => { sent.push(JSON.parse(init.body)); return json(replies.shift()); };
  const gemini = new Jo.Gemini("KEY", "gemini-flash-latest", http);
  const agent = new Jo.Agent(gemini, new Jo.Tools({ tasks: new Jo.TaskStore(memoryStorage()), search: gemini }));
  const used = [];
  assert.match(await agent.ask("weather in Chennai?", (t) => used.push(t)), /33 degrees/);
  assert.deepEqual(used, ["web_search"]);
  assert.deepEqual(sent[1].tools, [{ google_search: {} }]);
  assert.match(sent[1].contents[0].parts[0].text, /Question: Chennai weather today/);
  const result = sent[2].contents.at(-1).parts[0].functionResponse.response.result;
  assert.equal(result, "Chennai: 33°C, light rain in the evening.\nSources: imd.gov.in, thehindu.com");
  // Without a search engine Jo says what's missing instead of failing.
  assert.match(await new Jo.Tools({ tasks: new Jo.TaskStore(memoryStorage()) }).call("web_search", { query: "x" }), /Gemini key/);
});
