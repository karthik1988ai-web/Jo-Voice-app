# Jo — Karthik's personal assistant

Jo is a "Jarvis"-style assistant with a holographic HUD. Talk to it (or type) in English or Tamil:

- **"Any important unread mail?"**: reads your **Zoho Mail**
- **"How many Kavery orders today? Any pending deliveries?"**: reads the **Kavery Delivery** Supabase database
- **"What are today's Thirumal sales? Who owes us money?"**: reads the **Thirumal accounts** Supabase database
- **"What's on my calendar this week?"**: your **Google Calendar**
- **"Remind me to call the supplier at 5 PM"**, **"Add a meeting with the Britannia rep tomorrow at 11"**: Jo's own **tasks and agenda**, with reminders

Every morning (8:00 AM by default) Jo writes a **morning brief** covering calendar, tasks, Kavery, Thirumal and important mail.

There are two versions:

1. **PC version (web, in `web/`)**: start here. It runs in Chrome or Microsoft Edge.
2. **Android app (in `app/`)**: built by GitHub Actions. Later the web version can also be wrapped as an APK (Capacitor), so both share one code base.

Jo's brain is **Google Gemini** on the free tier. Jo is **read-only** for mail and both business databases. It only adds or completes its own tasks and agenda items.

> ⚠️ This repository is **public**. Never commit API keys, Supabase keys or keystores to it. Jo stores keys only in your browser (PC) or encrypted on your phone (Android).

## Cost and privacy

- **Gemini free tier: ₹0.** Google allows a daily number of free requests. That's plenty for one person. If you hit the limit, Jo says so; it resets daily.
- **Privacy:** on the free tier, Google may use what Jo sends (mail snippets and business numbers) to improve its products. Turning on billing for the key stops that.
- **Supabase Edge Function** (the "Jo bridge") is free within Supabase's free plan.

---

# PC version

## 1. Open Jo

- **Hosted (recommended):** merge this branch into `main`, then in the repo go to **Settings → Pages → Source: GitHub Actions**. After the "Web app" workflow runs, Jo is at
  **https://karthik1988ai-web.github.io/Jo-Voice-app/**. Bookmark it, or in Edge/Chrome use **⋯ → Apps → Install** to get a desktop icon.
- **From a file:** download the `web` folder and double-click `index.html`.

Use **Chrome or Edge**: voice input needs them. Edge has the best Tamil voice (Pallavi / Valluvar).
Allow the microphone and notifications when asked.

**Controls:** click the glowing core, the mic button, or press **Space** to talk. **Esc** stops speaking. The quick-command buttons on the left ask common questions.

## 2. Gemini key (Jo's brain)

1. Open https://aistudio.google.com/apikey → **Create API key**.
2. In Jo: ⚙ **Settings → Gemini → API key** → **Test Gemini** → **Save**.

## 3. Kavery Delivery and Thirumal (Supabase)

In each project's Supabase dashboard → **Project Settings → API keys / Data API**, copy the **Project URL** and the **secret key** (`sb_secret_…`, or the legacy `service_role` key). Paste them into Jo's settings, list the tables Jo may read (e.g. `orders, deliveries, payments`), then **Test**.

Why the secret key: the public anon/publishable key is limited by Row Level Security and usually can't see business data. Jo's code only ever **reads**, but the secret key itself could write if it ever leaked, so only use Jo on your own computer. If you think a key leaked, roll it in Supabase.

For exact daily figures, add the optional summary function described in section A4 below and type its name (`jo_daily_summary`) in settings.

## 4. Jo bridge: Zoho Mail and Google Calendar (one-time, about 15 minutes)

Browsers aren't allowed to call Zoho Mail or Google's calendar feed directly, so Jo uses a small **Supabase Edge Function** as a relay. The code is in `supabase/functions/jo-bridge/index.ts`. Put it in the **Kavery** Supabase project (any project works).

**a) Create its settings table:** Supabase → **SQL Editor** → run:

```sql
create table if not exists public.jo_bridge_settings (key text primary key, value text not null);
alter table public.jo_bridge_settings enable row level security;  -- no policies: only the function can read it
```

**b) Deploy the function:** **Edge Functions → Deploy a new function → Via editor**. Name it `jo-bridge`, replace the sample code with the contents of `supabase/functions/jo-bridge/index.ts`, and click **Deploy**. Then open the function's **Details/Settings** and turn **off "Verify JWT"**. Jo uses its own key instead.

**c) Zoho Self Client:** https://api-console.zoho.com → **Add Client → Self Client → Create**. Copy the **Client ID** and **Client Secret**.

**d) Google Calendar private link:** https://calendar.google.com → ⚙ **Settings** → click your calendar on the left → **Integrate calendar** → copy **Secret address in iCal format**. Treat it like a password.

**e) Function secrets:** Supabase → **Edge Functions → Secrets**, add:

| Name | Value |
|---|---|
| `JO_BRIDGE_KEY` | any long random text you make up (Jo sends it with every call) |
| `ZOHO_CLIENT_ID` | from step c |
| `ZOHO_CLIENT_SECRET` | from step c |
| `ZOHO_REGION` | `com` |
| `CALENDAR_ICS_URLS` | the secret iCal address from step d (several can be separated by spaces) |

**f) Connect Jo:** in Jo's settings fill in **Bridge URL** (`https://<project-ref>.supabase.co/functions/v1/jo-bridge`) and **Bridge key** (your `JO_BRIDGE_KEY`), then click **Test mail & calendar**.
Then in Zoho's Self Client go to **Generate Code**, with scope `ZohoMail.accounts.READ,ZohoMail.messages.READ,ZohoMail.folders.READ`, duration 10 minutes, and click **Create**. Paste the code into Jo's **Zoho grant code** field and click **Connect Zoho Mail**. You only do this once.

**Kavery and Thirumal through the bridge (recommended):** Supabase refuses secret keys used from a browser, so Jo reads both apps through this function. Add these secrets too:

| Name | Value |
|---|---|
| `KAVERY_URL` | Kavery's project URL, e.g. `https://xxxx.supabase.co` |
| `KAVERY_SECRET_KEY` | Kavery's secret key (`sb_secret_…`) |
| `THIRUMAL_URL`, `THIRUMAL_SECRET_KEY` | only if the bridge is **not** running in the Thirumal project |

The bridge only calls the read-only `jo_daily_summary` and `jo_lookup` functions in those projects. In Jo's settings keep **"Read through the Jo bridge"** ticked for both apps.

**New-mail watch:** while Jo is open, it checks **all incoming Zoho folders** (Inbox and your own folders; Sent, Drafts, Templates, Outbox and Trash are skipped). By default it checks every 3 minutes; change the interval in Settings, where 0 turns it off. New emails appear in the **Mail** panel with their folder name, pop up as desktop notifications, and are announced aloud. "Announce new emails aloud" in Settings turns the spoken part off. Click an email in the panel and Jo reads it to you. The first check after opening Jo only learns what's already unread, so old mail isn't announced.

If you update the `jo-bridge` code later, paste the new version into the same function in Supabase and click **Deploy** again.

Notes: Google's iCal feed can lag behind the calendar by up to a few hours. Events you add by voice go into **Jo's agenda** (marked **JO**), not into Google Calendar.

## Google Tasks & Google Calendar (save tasks and meetings in your Google account)

When connected, "remind me to…" creates a task in **Google Tasks** and "add a meeting…" creates an event in **Google Calendar**. Jo also reads your calendar live from Google, so the iCal link isn't needed. The Google sign-in is kept by the Jo bridge; no Google secret is stored in the browser.

**1. Google Cloud (one time, about 10 minutes).** Open https://console.cloud.google.com, signed in with the Google account whose Tasks and Calendar you use.
- Create a project, e.g. **Jo**.
- **APIs & Services → Library:** enable **Google Tasks API** and **Google Calendar API**.
- **Google Auth Platform (OAuth consent screen):** choose **External**, app name **Jo**, and your email as support and contact email.
  - **Audience:** add your Gmail address as a **test user**, then click **Publish app**. While the app stays in "Testing", Google signs Jo out every 7 days.
  - **Data access (optional):** add the scopes `.../auth/tasks` and `.../auth/calendar.events`.
- **Clients → Create client → Web application:**
  - Under **Authorized redirect URIs**, add exactly `https://karthik1988ai-web.github.io/Jo-Voice-app/`
  - Click **Create**, then copy the **Client ID** and **Client secret**.

**2. Supabase secrets.** In the project where the bridge runs: Edge Functions → Secrets → add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. If your bridge code is older than this feature, paste the latest `supabase/functions/jo-bridge/index.ts` into the function and click **Deploy**.

**3. Jo.** Open ⚙ Settings → **Google Tasks & Calendar** → **Connect Google**.
- Sign in. Google shows **"Google hasn't verified this app"**: click **Continue**, since it's your own app.
- Allow both permissions. You'll come back to Jo with "Google connected".
- **Test Google** shows how many open tasks you have.

Notes:
- Google Tasks stores only a due **date**. For "at 5 PM" reminders Jo writes `Jo reminder: YYYY-MM-DD 17:00` into the task's notes and pops up the reminder while Jo is open.
- Calendar events use Google's own reminders, so they also notify on your phone.
- Untick **"Save tasks and events to Google"** to go back to saving tasks only in this browser.

## Jo's voice

⚙ Settings → **Jo's voice**:

- **Gemini AI voice (natural):** Google's AI voices (Charon, Kore, Puck, Sulafat and 26 more). The same voice speaks English and Tamil, and you can pick a different one for each language. **▶ Preview** plays a sample. These voices use Gemini's free daily voice limit; when it runs out, Jo automatically uses the PC voice until it resets.
- **PC voice (instant, offline):** the voices installed in Windows or your browser. For Tamil, Microsoft Edge includes Pallavi and Valluvar.

Short alerts (new-mail and reminder announcements) always use the PC voice, so they don't use up the Gemini voice limit.

## 5. Morning brief and reminders

- Jo makes the brief at the set time if it's open, or the first time you open it after that time. A notification lets you play it.
- Task and agenda reminders pop up as desktop notifications while Jo is open in a tab.

## PC version files

| File | What it does |
|---|---|
| `web/index.html`, `web/style.css` | The HUD layout and look |
| `web/jo-ui.js` | Voice in/out, panels, settings, brief schedule, reminders |
| `web/jo-core.js` | Jo's brain and tools: Gemini, Supabase, the bridge, tasks (no page code, so it can move into an APK later) |
| `supabase/functions/jo-bridge/index.ts` | The bridge: Zoho Mail and Google Calendar (iCal) |
| `web/test/`, `supabase/functions/jo-bridge/index_test.ts` | Tests, run by the "Web app" workflow on every push |

To change Jo's personality, reply length or what goes in the brief, edit `systemPrompt()` and `morningBrief()` in `web/jo-core.js`.

---

# Android app

### A1. Get the APK (GitHub builds it)

Every push to this repository runs **Actions → Build APK** (about 5–8 minutes).
When it shows a green tick, open the run and download **Jo-apk** at the bottom. Unzip it to get `app-debug.apk`.

Send the APK to your phone (WhatsApp to yourself or Google Drive), tap it, allow "install unknown apps", then **Install**. If Play Protect warns you, choose **Install anyway**.

**Optional, recommended: keep settings across updates.** Android only installs a new build over the old one if both are signed with the same key. Without one, you must uninstall the old Jo first, which loses its settings. To fix this once:
GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**, and add
`JO_KEYSTORE_BASE64` (the base64 keystore text) and `JO_KEYSTORE_PASSWORD` (its password).

### A2. Gemini key

1. Open https://aistudio.google.com/apikey and sign in with Google.
2. **Create API key** and copy it.
3. In Jo: **Settings → Gemini API key** → paste → **Test Gemini**.

The model defaults to `gemini-flash-latest`, Google's current fast model. You can type another model name, such as `gemini-2.5-flash`, if Google changes its free models.

### A3. Zoho Mail

Jo uses a Zoho **Self Client**, so no web login page or server is needed:

1. Open https://api-console.zoho.com (use `.in`/`.eu` instead of `.com` if your Zoho account is in that region) → **Add Client → Self Client → Create**.
2. **Client Secret** tab: copy the **Client ID** and **Client Secret** into Jo's Settings.
3. **Generate Code** tab:
   - Scope: `ZohoMail.accounts.READ,ZohoMail.messages.READ,ZohoMail.folders.READ`
   - Time duration: 10 minutes. Description: "Jo".
   - **Create**, then copy the code.
4. Within those 10 minutes, paste it into Jo's **Grant code** field and tap **Connect**, then **Test**.

You only do this once. If Jo later says the Zoho login expired, repeat step 3 and step 4.

### A4. Kavery Delivery and Thirumal (Supabase)

For each app, open its project at https://supabase.com/dashboard → **Project Settings → API keys** (Data API):

| Jo setting | Where to find it |
|---|---|
| **Project URL** | `https://<project-ref>.supabase.co` (Project Settings → Data API) |
| **API key** | the **secret** key (`sb_secret_…`), or the legacy **service_role** key |
| **Tables Jo may read** | e.g. `orders, deliveries, payments, riders`. Leave blank to let Jo see all tables. |
| **Summary function** | optional, see below |

Tap **Test** for each.

**Why the secret key?** Your apps' public (anon/publishable) keys are limited by Row Level Security, which usually hides business data from anyone who isn't logged in, so Jo would see nothing. The secret key can read everything. Jo's code only ever **reads** (it never sends insert, update or delete), and the key is stored encrypted on your phone. Because the secret key could write if it ever leaked, keep your phone locked. If you lose the phone, **rotate the key** in Supabase (API keys → roll/delete).

#### Optional: a summary function for a faster, sharper brief

Without a summary function, Jo's brief shows each allowed table's row count and latest rows. For exact figures like "orders today" and "payments today", create a SQL function in each project (**SQL Editor → New query**). Adapt the table and column names to your schema. Example for Kavery:

```sql
create or replace function public.jo_daily_summary(p_date date default current_date)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'date',              p_date,
    'new_orders',        (select count(*) from orders where created_at::date = p_date),
    'delivered',         (select count(*) from orders where status = 'delivered' and updated_at::date = p_date),
    'pending_orders',    (select count(*) from orders where status in ('pending', 'assigned', 'out_for_delivery')),
    'payments_received', (select coalesce(sum(amount), 0) from payments where created_at::date = p_date)
  );
$$;

-- Only Jo's secret key may call it, never the public app key.
revoke execute on function public.jo_daily_summary(date) from public, anon, authenticated;
grant execute on function public.jo_daily_summary(date) to service_role;
```

For Thirumal, return things like today's sales, collections, outstanding receivables and low stock. Then type `jo_daily_summary` into Jo's **Summary function** field.
Jo calls it with `{"p_date": "YYYY-MM-DD"}` and passes whatever JSON it returns to Gemini.

### A5. Phone settings

- **Allow notifications and calendar** when Jo asks on first launch.
- **On-time morning brief:** phone Settings → Apps → Jo → Battery → **Unrestricted**. On Xiaomi, Redmi, Oppo or Vivo, also turn on **Autostart**.
- **Tamil voice:** Settings → System → Languages → Text-to-speech → Google engine → Install voice data → **Tamil**. Then choose **தமிழ்** in Jo's Settings.
- **Voice input** uses Google's speech recognizer (the Google app must be enabled).

---

### How the Android app works

| File | What it does |
|---|---|
| `core/JoAgent.kt` | Jo's brain: the Gemini conversation, the system prompt, the morning-brief prompt |
| `core/JoTools.kt` | Functions Gemini can call: mail, app summaries and queries, tasks, calendar |
| `core/GeminiClient.kt` | Gemini REST API (`generateContent` with function calling) |
| `core/ZohoMailClient.kt` | Zoho Mail (read-only) with Self Client OAuth |
| `core/SupabaseSource.kt` | Read-only Supabase REST: table queries and the optional summary function |
| `core/TaskStore.kt` | Jo's task list (JSON file on the phone) |
| `android/CalendarRepo.kt` | Phone calendar read and add |
| `android/BriefWorker.kt` | Daily morning brief in the background, plus notification |
| `android/ReminderWorker.kt` | Task reminder notifications |
| `android/Prefs.kt` | Encrypted settings |
| `ui/` | Screens: Jo (voice/chat), Today (tasks + calendar), Settings |

To change Jo's personality, reply length, or what goes into the brief, edit `systemPrompt()` and `morningBrief()` in `core/JoAgent.kt`.

Unit tests for the core (Gemini tool loop, Zoho, Supabase, tasks) run on every build: `./gradlew testDebugUnitTest`.
