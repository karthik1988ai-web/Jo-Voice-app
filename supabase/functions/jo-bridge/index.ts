// Jo bridge: lets the Jo web app reach services that browsers can't call directly
// (Zoho Mail, Google Calendar's private iCal link). Read-only.
//
// Deploy in the Supabase dashboard: Edge Functions → Deploy a new function → Via editor,
// name it "jo-bridge", paste this file, and turn OFF "Verify JWT" (Jo uses its own key).
//
// Secrets (Edge Functions → Secrets):
//   JO_BRIDGE_KEY        any long random text; the same value goes in Jo's settings
//   ZOHO_CLIENT_ID       from api-console.zoho.com → Self Client
//   ZOHO_CLIENT_SECRET
//   ZOHO_REGION          com (default), in, eu, com.au, jp
//   CALENDAR_ICS_URLS    Google Calendar "Secret address in iCal format"; several separated by spaces
//   KAVERY_URL           Kavery Delivery project URL, e.g. https://xxxx.supabase.co
//   KAVERY_SECRET_KEY    Kavery's secret key (sb_secret_...). Supabase refuses secret keys from browsers,
//                        so Jo reads both business apps through this function instead.
//   THIRUMAL_URL / THIRUMAL_SECRET_KEY   only if Thirumal is NOT the project this function runs in
//   GOOGLE_CLIENT_ID     Google Cloud OAuth client (Web application) for Google Tasks + Calendar
//   GOOGLE_CLIENT_SECRET
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
//
// One table stores the Zoho refresh token (run once in the SQL editor):
//   create table if not exists public.jo_bridge_settings (key text primary key, value text not null);
//   alter table public.jo_bridge_settings enable row level security;  -- no policies: service role only

import ICAL from "npm:ical.js@2.2.1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-jo-key, authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Env = (name: string) => string | undefined;

export function createHandler(env: Env = (n) => Deno.env.get(n), http: typeof fetch = fetch) {
  const region = () => env("ZOHO_REGION") || "com";
  let accessToken = "";
  let accessExpiry = 0;
  let accountId = "";
  let googleToken = "";
  let googleExpiry = 0;
  type Folder = { id: string; name: string; type: string };
  let folderCache: { at: number; list: Folder[] } = { at: 0, list: [] };

  // ---- settings table (service role) ----
  const restBase = () => `${env("SUPABASE_URL")}/rest/v1/jo_bridge_settings`;
  const serviceHeaders = () => {
    const key = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const h: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
    if (key.startsWith("eyJ")) h.Authorization = `Bearer ${key}`;
    return h;
  };
  async function getSetting(key: string): Promise<string> {
    const r = await http(`${restBase()}?key=eq.${encodeURIComponent(key)}&select=value`, { headers: serviceHeaders() });
    if (!r.ok) throw new Error(`Settings table not readable (${r.status}). Did you create jo_bridge_settings?`);
    const rows = await r.json();
    return rows[0]?.value ?? "";
  }
  async function setSetting(key: string, value: string) {
    const r = await http(restBase(), {
      method: "POST",
      headers: { ...serviceHeaders(), Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ key, value }),
    });
    if (!r.ok) throw new Error(`Could not save setting (${r.status}): ${(await r.text()).slice(0, 200)}`);
  }

  // ---- Zoho ----
  async function zohoToken(params: Record<string, string>) {
    const form = new URLSearchParams({
      client_id: env("ZOHO_CLIENT_ID") ?? "",
      client_secret: env("ZOHO_CLIENT_SECRET") ?? "",
      ...params,
    });
    const r = await http(`https://accounts.zoho.${region()}/oauth/v2/token`, { method: "POST", body: form });
    return await r.json();
  }

  async function zohoAccess(): Promise<string> {
    if (accessToken && Date.now() < accessExpiry) return accessToken;
    const refresh = await getSetting("zoho_refresh_token");
    if (!refresh) throw new Error("Zoho Mail is not connected yet. Use Connect in Jo's settings.");
    const json = await zohoToken({ refresh_token: refresh, grant_type: "refresh_token" });
    if (!json.access_token) throw new Error(`Zoho login expired (${json.error ?? "no token"}). Reconnect Zoho Mail in Jo's settings.`);
    accessToken = json.access_token;
    accessExpiry = Date.now() + ((json.expires_in ?? 3600) - 120) * 1000;
    return accessToken;
  }

  async function zohoGet(path: string) {
    const r = await http(`https://mail.zoho.${region()}/api${path}`, {
      headers: { Authorization: `Zoho-oauthtoken ${await zohoAccess()}` },
    });
    if (!r.ok) throw new Error(`Zoho Mail error ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return await r.json();
  }

  async function account(): Promise<string> {
    if (accountId) return accountId;
    const data = (await zohoGet("/accounts")).data ?? [];
    if (!data.length) throw new Error("No Zoho Mail account found");
    return (accountId = String(data[0].accountId));
  }

  // Folders that hold incoming mail: everything except Sent, Drafts, Templates, Outbox and Trash.
  const SKIP_FOLDERS = /^(sent|drafts|templates|outbox|trash)$/i;
  async function incomingFolders(): Promise<Folder[]> {
    if (Date.now() - folderCache.at < 10 * 60_000 && folderCache.list.length) return folderCache.list;
    const data = (await zohoGet(`/accounts/${await account()}/folders`)).data ?? [];
    // deno-lint-ignore no-explicit-any
    const list: Folder[] = data.map((f: any) => ({ id: String(f.folderId), name: String(f.folderName ?? ""), type: String(f.folderType ?? "") }))
      .filter((f: Folder) => !SKIP_FOLDERS.test(f.type) && !SKIP_FOLDERS.test(f.name));
    folderCache = { at: Date.now(), list };
    return list;
  }

  /** Unread mail across every incoming folder, newest first. */
  async function unreadAllFolders(limit: number) {
    const folders = await incomingFolders();
    const perFolder = Math.min(Math.max(limit, 5), 30);
    const results: ReturnType<typeof toMail>[] = [];
    // A few folders at a time keeps us well inside Zoho's rate limits.
    for (let i = 0; i < folders.length; i += 4) {
      const batch = folders.slice(i, i + 4);
      const lists = await Promise.all(batch.map(async (f) => {
        const q = new URLSearchParams({ folderId: f.id, status: "unread", limit: String(perFolder), sortorder: "false" });
        try {
          return ((await zohoGet(`/accounts/${await account()}/messages/view?${q}`)).data ?? [])
            // deno-lint-ignore no-explicit-any
            .map((m: any) => ({ ...toMail(m), folder: f.name }));
        } catch {
          return []; // one unreadable folder shouldn't hide the rest
        }
      }));
      lists.forEach((l) => results.push(...l));
    }
    return results.sort((a, b) => b.received - a.received).slice(0, limit);
  }

  // deno-lint-ignore no-explicit-any
  const toMail = (m: any) => ({
    messageId: String(m.messageId ?? ""),
    folderId: String(m.folderId ?? ""),
    from: m.sender || m.fromAddress || "",
    subject: m.subject ?? "",
    summary: String(m.summary ?? "").slice(0, 300),
    received: Number(m.receivedTime ?? 0),
    unread: String(m.status) === "0",
  });

  // ---- Google Tasks + Calendar (Karthik signs in once; the refresh token stays here) ----
  const GOOGLE_SCOPES = "https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/calendar.events";
  function googleClient() {
    const id = env("GOOGLE_CLIENT_ID"), secret = env("GOOGLE_CLIENT_SECRET");
    if (!id || !secret) throw new Error("Google is not set up in the bridge. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Supabase (Edge Functions → Secrets).");
    return { id: id.trim(), secret: secret.trim() };
  }
  async function googleTokenCall(params: Record<string, string>) {
    const { id, secret } = googleClient();
    const r = await http("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({ client_id: id, client_secret: secret, ...params }),
    });
    return await r.json();
  }
  async function googleAccess(): Promise<string> {
    if (googleToken && Date.now() < googleExpiry) return googleToken;
    const refresh = await getSetting("google_refresh_token");
    if (!refresh) throw new Error("Google is not connected yet. Use Connect Google in Jo's settings.");
    const json = await googleTokenCall({ refresh_token: refresh, grant_type: "refresh_token" });
    if (!json.access_token) throw new Error(`Google sign-in expired (${json.error ?? "no token"}). Connect Google again in Jo's settings.`);
    googleToken = json.access_token;
    googleExpiry = Date.now() + ((json.expires_in ?? 3600) - 120) * 1000;
    return googleToken;
  }
  async function google(url: string, init: RequestInit = {}) {
    const r = await http(url, {
      ...init,
      headers: { Authorization: `Bearer ${await googleAccess()}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    if (r.status === 204) return {};
    const text = await r.text();
    if (!r.ok) {
      let msg = text.slice(0, 200);
      try { msg = JSON.parse(text).error?.message ?? msg; } catch { /* not JSON */ }
      throw new Error(`Google error ${r.status}: ${msg}`);
    }
    return text ? JSON.parse(text) : {};
  }
  const TASKS = "https://tasks.googleapis.com/tasks/v1/lists/@default/tasks";
  const CAL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
  // deno-lint-ignore no-explicit-any
  const toTask = (t: any) => ({ id: t.id, title: t.title ?? "", notes: t.notes ?? "", due: t.due ?? null, done: t.status === "completed" });
  // deno-lint-ignore no-explicit-any
  const toEvent = (e: any) => {
    const allDay = !e.start?.dateTime;
    const start = allDay ? Date.parse(`${e.start?.date}T00:00:00`) : Date.parse(e.start.dateTime);
    const end = allDay ? Date.parse(`${e.end?.date}T00:00:00`) : Date.parse(e.end?.dateTime ?? e.start.dateTime);
    return { title: e.summary || "(no title)", start, end, allDay, location: e.location || "", ...(allDay ? { date: e.start.date } : {}) };
  };

  // ---- Business apps (Kavery, Thirumal): only the jo_ read-only functions ----
  const APP_FUNCTIONS: Record<string, string> = { app_summary: "jo_daily_summary", app_lookup: "jo_lookup" };
  function appProject(app: string) {
    const name = app.toUpperCase();
    if (!/^(KAVERY|THIRUMAL)$/.test(name)) throw new Error("app must be kavery or thirumal");
    // Thirumal defaults to the project this function runs in.
    const url = env(`${name}_URL`) || (name === "THIRUMAL" ? env("SUPABASE_URL") : "");
    const key = env(`${name}_SECRET_KEY`) || (name === "THIRUMAL" ? env("SUPABASE_SERVICE_ROLE_KEY") : "");
    if (!url || !key) throw new Error(`${app} is not set up in the bridge. Add ${name}_URL and ${name}_SECRET_KEY in Supabase (Edge Functions → Secrets).`);
    return { url: url.trim().replace(/\/+$/, ""), key: key.trim() };
  }
  async function appCall(action: string, app: string, args: Record<string, unknown>) {
    const { url, key } = appProject(app);
    const fn = APP_FUNCTIONS[action];
    const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
    if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
    const r = await http(`${url}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(args) });
    const text = await r.text();
    if (r.status === 404) throw new Error(`${app}: function ${fn} not found in that project.`);
    if (r.status === 401 || r.status === 403) throw new Error(`${app}: the secret key was refused. Check ${app.toUpperCase()}_SECRET_KEY.`);
    if (!r.ok) throw new Error(`${app} ${fn} error ${r.status}: ${text.slice(0, 200)}`);
    return text;
  }

  // ---- Calendar (iCal) ----
  async function calendar(from: number, to: number) {
    const urls = (env("CALENDAR_ICS_URLS") ?? "").split(/\s+/).filter(Boolean);
    if (!urls.length) throw new Error("No calendar connected. Add CALENDAR_ICS_URLS in the jo-bridge secrets.");
    const events: { title: string; start: number; end: number; allDay: boolean; location: string; date?: string }[] = [];
    for (const url of urls) {
      const r = await http(url);
      if (!r.ok) throw new Error(`Calendar link returned ${r.status}`);
      const comp = new ICAL.Component(ICAL.parse(await r.text()));
      for (const v of comp.getAllSubcomponents("vevent")) {
        const ev = new ICAL.Event(v);
        if (ev.isRecurrenceException()) continue; // covered by the master's expansion below
        const push = (start: ICAL.Time, end: ICAL.Time, item: ICAL.Event) => {
          const s = start.toJSDate().getTime();
          const e = end.toJSDate().getTime();
          if (e <= from || s >= to) return;
          events.push({
            title: item.summary || "(no title)",
            start: s,
            end: e,
            allDay: start.isDate,
            location: item.location || "",
            ...(start.isDate ? { date: start.toString() } : {}),
          });
        };
        if (!ev.isRecurring()) {
          push(ev.startDate, ev.endDate, ev);
          continue;
        }
        const it = ev.iterator();
        for (let next = it.next(), n = 0; next && n < 2000; next = it.next(), n++) {
          if (next.toJSDate().getTime() >= to) break;
          const d = ev.getOccurrenceDetails(next);
          push(d.startDate, d.endDate, d.item);
        }
      }
    }
    return events.sort((a, b) => a.start - b.start);
  }

  // deno-lint-ignore no-explicit-any
  async function run(action: string, body: any) {
    switch (action) {
      case "ping":
        return { ok: true };
      case "zoho_connect": {
        const json = await zohoToken({ code: String(body.code ?? "").trim(), grant_type: "authorization_code" });
        if (!json.refresh_token) {
          throw new Error(`Zoho said: ${json.error ?? JSON.stringify(json).slice(0, 200)}. Grant codes expire in minutes; make a fresh one.`);
        }
        await setSetting("zoho_refresh_token", json.refresh_token);
        accessToken = "";
        accountId = "";
        return { connected: true };
      }
      case "zoho_unread":
        return { mails: await unreadAllFolders(Math.min(Number(body.limit) || 15, 50)) };
      case "zoho_recent": {
        const q = new URLSearchParams({ limit: String(Math.min(Number(body.limit) || 10, 30)), sortorder: "false" });
        return { mails: ((await zohoGet(`/accounts/${await account()}/messages/view?${q}`)).data ?? []).map(toMail) };
      }
      case "zoho_search": {
        const query = String(body.query ?? "");
        const q = new URLSearchParams({
          searchKey: query.includes(":") ? query : `entire:${query}`,
          limit: String(Math.min(Number(body.limit) || 8, 30)),
        });
        return { mails: ((await zohoGet(`/accounts/${await account()}/messages/search?${q}`)).data ?? []).map(toMail) };
      }
      case "zoho_read": {
        const folder = encodeURIComponent(String(body.folderId));
        const message = encodeURIComponent(String(body.messageId));
        const json = await zohoGet(`/accounts/${await account()}/folders/${folder}/messages/${message}/content`);
        return { content: String(json.data?.content ?? "") };
      }
      case "calendar":
        return { events: await calendar(Number(body.from), Number(body.to)) };
      case "app_summary":
        return { result: await appCall(action, String(body.app ?? ""), { p_date: body.date || null }) };
      case "app_lookup":
        return { result: await appCall(action, String(body.app ?? ""), { p_search: String(body.search ?? ""), p_from: body.from || null, p_to: body.to || null }) };

      case "google_auth_url": {
        const q = new URLSearchParams({
          client_id: googleClient().id, redirect_uri: String(body.redirectUri ?? ""), response_type: "code",
          scope: GOOGLE_SCOPES, access_type: "offline", prompt: "consent", include_granted_scopes: "true",
          state: String(body.state ?? ""),
        });
        return { url: `https://accounts.google.com/o/oauth2/v2/auth?${q}` };
      }
      case "google_connect": {
        const json = await googleTokenCall({
          code: String(body.code ?? ""), redirect_uri: String(body.redirectUri ?? ""), grant_type: "authorization_code",
        });
        if (!json.refresh_token) {
          throw new Error(`Google said: ${json.error_description ?? json.error ?? "no refresh token"}. Try Connect Google again.`);
        }
        await setSetting("google_refresh_token", json.refresh_token);
        googleToken = json.access_token ?? "";
        googleExpiry = Date.now() + ((json.expires_in ?? 3600) - 120) * 1000;
        return { connected: true };
      }
      case "google_status":
        return { connected: !!(await getSetting("google_refresh_token")) };
      case "gtasks_list": {
        const q = new URLSearchParams({ maxResults: "100", showCompleted: String(!!body.includeDone), showHidden: String(!!body.includeDone) });
        return { tasks: ((await google(`${TASKS}?${q}`)).items ?? []).map(toTask) };
      }
      case "gtasks_add": {
        const task: Record<string, string> = { title: String(body.title ?? "").slice(0, 500) };
        if (body.due) task.due = String(body.due);
        if (body.notes) task.notes = String(body.notes).slice(0, 2000);
        return { task: toTask(await google(TASKS, { method: "POST", body: JSON.stringify(task) })) };
      }
      case "gtasks_update": {
        const id = encodeURIComponent(String(body.id ?? ""));
        const patch = body.done ? { status: "completed" } : { status: "needsAction", completed: null };
        return { task: toTask(await google(`${TASKS}/${id}`, { method: "PATCH", body: JSON.stringify(patch) })) };
      }
      case "gtasks_delete":
        await google(`${TASKS}/${encodeURIComponent(String(body.id ?? ""))}`, { method: "DELETE" });
        return { deleted: true };
      case "gcal_list": {
        const q = new URLSearchParams({
          timeMin: new Date(Number(body.from)).toISOString(), timeMax: new Date(Number(body.to)).toISOString(),
          singleEvents: "true", orderBy: "startTime", maxResults: "100",
        });
        return { events: ((await google(`${CAL}?${q}`)).items ?? []).filter((e: { status?: string }) => e.status !== "cancelled").map(toEvent) };
      }
      case "gcal_add": {
        const tz = String(body.timeZone || "Asia/Kolkata");
        const event = {
          summary: String(body.title ?? "").slice(0, 300),
          location: body.location ? String(body.location) : undefined,
          start: { dateTime: new Date(Number(body.start)).toISOString(), timeZone: tz },
          end: { dateTime: new Date(Number(body.end)).toISOString(), timeZone: tz },
          description: "Added by Jo",
        };
        return { event: toEvent(await google(CAL, { method: "POST", body: JSON.stringify(event) })) };
      }
      default:
        throw new Error(`Unknown action ${action}`);
    }
  }

  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

    // Trimmed on both sides: a stray space from copy-paste is the most common mismatch.
    const key = (env("JO_BRIDGE_KEY") ?? "").trim();
    if (!key) return json({ error: "JO_BRIDGE_KEY is not set in Supabase (Edge Functions → Secrets). Add it, then try again." }, 401);
    if ((req.headers.get("x-jo-key") ?? "").trim() !== key) {
      return json({ error: "Jo's Bridge key doesn't match JO_BRIDGE_KEY in Supabase. Re-type the same text in both places." }, 401);
    }

    try {
      const body = await req.json().catch(() => ({}));
      return json(await run(String(body.action ?? ""), body));
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  };
}

if (!Deno.env.get("JO_BRIDGE_TEST")) Deno.serve(createHandler());
