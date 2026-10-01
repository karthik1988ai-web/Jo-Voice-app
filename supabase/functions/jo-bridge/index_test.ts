// Run: JO_BRIDGE_TEST=1 deno test --allow-env --allow-net=registry.npmjs.org supabase/functions/jo-bridge/
import { assertEquals, assert } from "jsr:@std/assert@1";
import { createHandler } from "./index.ts";

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:a
DTSTART:20261001T053000Z
DTEND:20261001T063000Z
SUMMARY:Britannia rep meeting
LOCATION:Office
END:VEVENT
BEGIN:VEVENT
UID:b
DTSTART:20260901T123000Z
DTEND:20260901T133000Z
RRULE:FREQ=WEEKLY;BYDAY=FR
SUMMARY:Weekly review
END:VEVENT
BEGIN:VEVENT
UID:c
DTSTART;VALUE=DATE:20261005
DTEND;VALUE=DATE:20261006
SUMMARY:Navaratri
END:VEVENT
END:VCALENDAR`;

function setup() {
  const store: Record<string, string> = {};
  const calls: string[] = [];
  const env: Record<string, string> = {
    JO_BRIDGE_KEY: "secret", ZOHO_CLIENT_ID: "cid", ZOHO_CLIENT_SECRET: "cs",
    SUPABASE_URL: "https://proj.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_x",
    CALENDAR_ICS_URLS: "https://cal.example/basic.ics",
    KAVERY_URL: "https://kav.supabase.co/", KAVERY_SECRET_KEY: "sb_secret_kav",
    GOOGLE_CLIENT_ID: "gid.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "gsecret",
  };
  const http = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const j = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s });
    if (url.startsWith("https://proj.supabase.co/rest/v1/jo_bridge_settings")) {
      if (init?.method === "POST") { const b = JSON.parse(String(init.body)); store[b.key] = b.value; return j([]); }
      const k = decodeURIComponent(url.split("key=eq.")[1].split("&")[0]);
      return j(store[k] ? [{ value: store[k] }] : []);
    }
    if (url === "https://accounts.zoho.com/oauth/v2/token") {
      const f = init!.body as URLSearchParams;
      if (f.get("grant_type") === "authorization_code") return j(f.get("code") === "good" ? { refresh_token: "RT" } : { error: "invalid_code" });
      return j(f.get("refresh_token") === "RT" ? { access_token: "AT", expires_in: 3600 } : { error: "invalid" });
    }
    if (url === "https://mail.zoho.com/api/accounts") return j({ data: [{ accountId: 77 }] });
    if (url === "https://mail.zoho.com/api/accounts/77/folders") {
      return j({ data: [
        { folderId: 2, folderName: "Inbox", folderType: "Inbox" },
        { folderId: 3, folderName: "Reports", folderType: "" },
        { folderId: 4, folderName: "Sent", folderType: "Sent" },
        { folderId: 5, folderName: "Trash", folderType: "Trash" },
      ] });
    }
    if (url.startsWith("https://mail.zoho.com/api/accounts/77/messages/view")) {
      const u = new URL(url);
      if (u.searchParams.get("folderId") === "2") {
        assertEquals(u.searchParams.get("status"), "unread");
        return j({ data: [{ messageId: 1, folderId: 2, sender: "Bank", subject: "GST", summary: "Due", receivedTime: "1759300000000", status: "0" }] });
      }
      if (u.searchParams.get("folderId") === "3") {
        return j({ data: [{ messageId: 9, folderId: 3, sender: "Britannia", subject: "MTD sales", summary: "4.2L", receivedTime: "1759400000000", status: "0" }] });
      }
      throw new Error(`folder ${u.searchParams.get("folderId")} should be skipped`);
    }
    if (url === "https://mail.zoho.com/api/accounts/77/folders/2/messages/1/content") return j({ data: { content: "<p>Hi</p>" } });
    if (url === "https://cal.example/basic.ics") return new Response(ICS);
    if (url === "https://oauth2.googleapis.com/token") {
      const f = init!.body as URLSearchParams;
      assertEquals(f.get("client_secret"), "gsecret");
      if (f.get("grant_type") === "authorization_code") {
        assertEquals(f.get("redirect_uri"), "https://jo.example/");
        return j(f.get("code") === "gcode" ? { refresh_token: "GRT", access_token: "GAT", expires_in: 3600 } : { error: "invalid_grant" });
      }
      return j(f.get("refresh_token") === "GRT" ? { access_token: "GAT2", expires_in: 3600 } : { error: "invalid_grant" });
    }
    if (url.startsWith("https://tasks.googleapis.com/tasks/v1/lists/@default/tasks")) {
      assert(String((init?.headers as Record<string, string>).Authorization).startsWith("Bearer GAT"));
      if (init?.method === "POST") {
        const t = JSON.parse(String(init.body));
        return j({ id: "t1", title: t.title, due: t.due, notes: t.notes, status: "needsAction" });
      }
      if (init?.method === "PATCH") return j({ id: "t1", title: "Call supplier", status: JSON.parse(String(init.body)).status });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return j({ items: [{ id: "t1", title: "Call supplier", due: "2026-10-01T00:00:00.000Z", status: "needsAction" }] });
    }
    if (url.startsWith("https://www.googleapis.com/calendar/v3/calendars/primary/events")) {
      if (init?.method === "POST") {
        const e = JSON.parse(String(init.body));
        assertEquals(e.start.timeZone, "Asia/Kolkata");
        return j({ summary: e.summary, start: e.start, end: e.end, location: e.location });
      }
      assert(url.includes("singleEvents=true"));
      return j({ items: [
        { summary: "Britannia rep", start: { dateTime: "2026-10-01T11:00:00+05:30" }, end: { dateTime: "2026-10-01T12:00:00+05:30" }, location: "Office" },
        { summary: "Navaratri", start: { date: "2026-10-05" }, end: { date: "2026-10-06" } },
        { summary: "Old", status: "cancelled", start: { dateTime: "2026-10-01T09:00:00+05:30" }, end: { dateTime: "2026-10-01T10:00:00+05:30" } },
      ] });
    }
    if (url === "https://kav.supabase.co/rest/v1/rpc/jo_daily_summary") {
      assertEquals((init!.headers as Record<string, string>).apikey, "sb_secret_kav");
      assertEquals(JSON.parse(String(init!.body)), { p_date: "2026-10-01" });
      return j({ orders_on_date: 14 });
    }
    if (url === "https://proj.supabase.co/rest/v1/rpc/jo_lookup") {
      assertEquals((init!.headers as Record<string, string>).apikey, "sb_secret_x"); // the bridge project's own key
      return j({ matching_invoices: 3 });
    }
    return j({}, 404);
  }) as typeof fetch;
  const handler = createHandler((n) => env[n], http);
  const call = (body: unknown, key = "secret") =>
    handler(new Request("https://x/functions/v1/jo-bridge", { method: "POST", headers: { "x-jo-key": key }, body: JSON.stringify(body) }))
      .then(async (r) => ({ status: r.status, body: await r.json() }));
  return { call, store, calls };
}

Deno.test("rejects wrong key", async () => {
  const { call } = setup();
  const wrong = await call({ action: "ping" }, "nope");
  assertEquals(wrong.status, 401);
  assert(wrong.body.error.includes("doesn't match"));
  assertEquals((await call({ action: "ping" }, "  secret  ")).body, { ok: true }); // spaces ignored
  assertEquals((await call({ action: "ping" })).body, { ok: true });
});

Deno.test("missing JO_BRIDGE_KEY secret is reported clearly", async () => {
  const handler = createHandler(() => undefined, fetch);
  const r = await handler(new Request("https://x", { method: "POST", headers: { "x-jo-key": "k" }, body: "{}" }));
  assertEquals(r.status, 401);
  assert((await r.json()).error.includes("JO_BRIDGE_KEY is not set"));
});

Deno.test("zoho connect, unread, read", async () => {
  const { call, store } = setup();
  const notConnected = await call({ action: "zoho_unread" });
  assertEquals(notConnected.status, 400);
  assert(notConnected.body.error.includes("not connected"));
  assert((await call({ action: "zoho_connect", code: "bad" })).body.error.includes("invalid_code"));
  assertEquals((await call({ action: "zoho_connect", code: "good" })).body, { connected: true });
  assertEquals(store.zoho_refresh_token, "RT");
  const unread = await call({ action: "zoho_unread", limit: 5 });
  // All incoming folders (Inbox + Reports), newest first; Sent and Trash skipped.
  assertEquals(unread.body.mails.map((m: { subject: string; folder: string }) => `${m.folder}:${m.subject}`), ["Reports:MTD sales", "Inbox:GST"]);
  assertEquals(unread.body.mails[1], { messageId: "1", folderId: "2", from: "Bank", subject: "GST", summary: "Due", received: 1759300000000, unread: true, folder: "Inbox" });
  assertEquals((await call({ action: "zoho_read", folderId: "2", messageId: "1" })).body.content, "<p>Hi</p>");
});

Deno.test("business apps go through the jo_ functions only", async () => {
  const { call } = setup();
  assertEquals((await call({ action: "app_summary", app: "kavery", date: "2026-10-01" })).body, { result: '{"orders_on_date":14}' });
  assertEquals((await call({ action: "app_lookup", app: "thirumal", search: "murugan" })).body, { result: '{"matching_invoices":3}' });
  const bad = await call({ action: "app_summary", app: "payroll" });
  assertEquals(bad.status, 400);
  assert(bad.body.error.includes("kavery or thirumal"));
});

Deno.test("google: connect, tasks and calendar through the bridge", async () => {
  const { call, store } = setup();
  assertEquals((await call({ action: "google_status" })).body, { connected: false });
  assert((await call({ action: "gtasks_list" })).body.error.includes("not connected"));
  const auth = await call({ action: "google_auth_url", redirectUri: "https://jo.example/", state: "s1" });
  const u = new URL(auth.body.url);
  assertEquals(u.searchParams.get("client_id"), "gid.apps.googleusercontent.com");
  assertEquals(u.searchParams.get("access_type"), "offline");
  assert(u.searchParams.get("scope")!.includes("auth/tasks"));
  assert((await call({ action: "google_connect", code: "bad", redirectUri: "https://jo.example/" })).body.error.includes("invalid_grant"));
  assertEquals((await call({ action: "google_connect", code: "gcode", redirectUri: "https://jo.example/" })).body, { connected: true });
  assertEquals(store.google_refresh_token, "GRT");
  assertEquals((await call({ action: "gtasks_list" })).body.tasks[0], { id: "t1", title: "Call supplier", notes: "", due: "2026-10-01T00:00:00.000Z", done: false });
  const added = await call({ action: "gtasks_add", title: "Call supplier", due: "2026-10-01T00:00:00.000Z", notes: "Reminder 5 PM" });
  assertEquals(added.body.task.notes, "Reminder 5 PM");
  assertEquals((await call({ action: "gtasks_update", id: "t1", done: true })).body.task.done, true);
  assertEquals((await call({ action: "gtasks_delete", id: "t1" })).body, { deleted: true });
  const ev = await call({ action: "gcal_list", from: Date.UTC(2026, 8, 30), to: Date.UTC(2026, 9, 7) });
  assertEquals(ev.body.events.map((e: { title: string }) => e.title), ["Britannia rep", "Navaratri"]);
  assertEquals(ev.body.events[0].start, Date.UTC(2026, 9, 1, 5, 30));
  assertEquals(ev.body.events[1].allDay, true);
  const start = Date.UTC(2026, 9, 2, 5, 30);
  const made = await call({ action: "gcal_add", title: "Dentist", start, end: start + 3600000, timeZone: "Asia/Kolkata" });
  assertEquals(made.body.event.title, "Dentist");
});

Deno.test("calendar expands recurring and all-day events", async () => {
  const { call } = setup();
  const from = Date.UTC(2026, 8, 30, 18, 30); // 1 Oct 00:00 IST
  const to = from + 7 * 86400000;
  const { body } = await call({ action: "calendar", from, to });
  const titles = body.events.map((e: { title: string }) => e.title);
  assertEquals(titles, ["Britannia rep meeting", "Weekly review", "Navaratri"]);
  assertEquals(body.events[1].start, Date.UTC(2026, 9, 2, 12, 30)); // Friday 2 Oct
  assertEquals(body.events[2].allDay, true);
  assertEquals(body.events[2].date, "2026-10-05");
});
