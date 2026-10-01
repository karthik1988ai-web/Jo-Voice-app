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

test("Gemini 429 gives a friendly message", async () => {
  const g = new Jo.Gemini("k", "m", async () => json({ error: { message: "quota" } }, 429));
  await assert.rejects(g.generate("s", [Jo.Gemini.userText("hi")]), /free-tier limit/);
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
  const rpc = new Jo.Supabase("Kavery", { url: "https://p.supabase.co", key: "eyJabc", fn: "jo_daily_summary" }, http);
  assert.equal(await rpc.summary("2026-10-01"), '{"orders":14}');
  assert.equal(seen.at(-1).headers.Authorization, "Bearer eyJabc");
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

test("TaskStore ordering, done and delete", () => {
  const s = new Jo.TaskStore(memoryStorage());
  const a = s.add("A"); const b = s.add("B", Jo.parseLocal("2026-10-02 09:30"));
  assert.deepEqual(s.open().map((t) => t.title), ["B", "A"]);
  s.setDone(b.id); assert.deepEqual(s.open().map((t) => t.title), ["A"]);
  assert.ok(s.remove(a.id)); assert.equal(s.all().length, 1);
  assert.throws(() => Jo.parseLocal("tomorrow"), /Bad date/);
});
