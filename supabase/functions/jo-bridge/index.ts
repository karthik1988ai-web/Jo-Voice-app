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
      case "zoho_recent": {
        const q = new URLSearchParams({ limit: String(Math.min(Number(body.limit) || 10, 30)), sortorder: "false" });
        if (action === "zoho_unread") q.set("status", "unread");
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
      default:
        throw new Error(`Unknown action ${action}`);
    }
  }

  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

    const key = env("JO_BRIDGE_KEY") ?? "";
    if (!key || req.headers.get("x-jo-key") !== key) return json({ error: "Wrong or missing Jo bridge key." }, 401);

    try {
      const body = await req.json().catch(() => ({}));
      return json(await run(String(body.action ?? ""), body));
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  };
}

if (!Deno.env.get("JO_BRIDGE_TEST")) Deno.serve(createHandler());
