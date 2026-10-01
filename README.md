# Jo — Karthik's personal voice assistant (Android)

Jo is a "Jarvis"-style assistant on your phone. Tap the mic and ask in English or Tamil:

- **"Any important unread mail?"**: reads your **Zoho Mail**
- **"How many Kavery orders today? Any pending deliveries?"**: reads the **Kavery Delivery** Supabase database
- **"What are today's Thirumal sales? Who owes us money?"**: reads the **Thirumal accounts** Supabase database
- **"What's on my calendar this week?"**, **"Add a meeting with the Britannia rep tomorrow at 11"**: your **phone calendar** (syncs with Google Calendar)
- **"Remind me to call the supplier at 5 PM"**: Jo's own **task list**, with a reminder notification

Every morning (8:00 AM by default) Jo writes a **morning brief** covering calendar, tasks, Kavery, Thirumal and important mail, and shows a notification. Tap it to hear the brief.

Jo's "brain" is **Google Gemini** on the free tier. Jo is **read-only** for mail and both business databases. It can only add or complete its own tasks and add calendar events.

---

## Cost and privacy

- **Gemini free tier: ₹0.** Google allows a daily number of free requests per model. That's plenty for one person (one morning brief plus dozens of questions a day). If you hit the limit, Jo says so; it resets daily.
- **Privacy:** on the free tier, Google may use what Jo sends (the mail snippets and business numbers in your questions) to improve its products. If that becomes a concern, enable billing on the Gemini key (paid tier data isn't used that way) or ask for a switch to another provider.
- Zoho Mail, Supabase and calendar access go **directly from your phone** to those services. Keys are stored **encrypted** on the phone, never in this repository.

> ⚠️ This repository is **public**. Never commit API keys, Supabase keys or keystores to it.

---

## Step 1: Get the app (GitHub builds it)

Every push to this repository runs **Actions → Build APK** (about 5–8 minutes).
When it shows a green tick, open the run and download **Jo-apk** at the bottom. Unzip it to get `app-debug.apk`.

Send the APK to your phone (WhatsApp to yourself or Google Drive), tap it, allow "install unknown apps", then **Install**. If Play Protect warns you, choose **Install anyway**.

**Optional, recommended: keep settings across updates.** Android only installs a new build over the old one if both are signed with the same key. Without one, you must uninstall the old Jo first, which loses its settings. To fix this once:
GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**, and add
`JO_KEYSTORE_BASE64` (the base64 keystore text) and `JO_KEYSTORE_PASSWORD` (its password).

## Step 2: Gemini key (Jo's brain)

1. Open https://aistudio.google.com/apikey and sign in with Google.
2. **Create API key** and copy it.
3. In Jo: **Settings → Gemini API key** → paste → **Test Gemini**.

The model defaults to `gemini-flash-latest`, Google's current fast model. You can type another model name, such as `gemini-2.5-flash`, if Google changes its free models.

## Step 3: Zoho Mail

Jo uses a Zoho **Self Client**, so no web login page or server is needed:

1. Open https://api-console.zoho.com (use `.in`/`.eu` instead of `.com` if your Zoho account is in that region) → **Add Client → Self Client → Create**.
2. **Client Secret** tab: copy the **Client ID** and **Client Secret** into Jo's Settings.
3. **Generate Code** tab:
   - Scope: `ZohoMail.accounts.READ,ZohoMail.messages.READ,ZohoMail.folders.READ`
   - Time duration: 10 minutes. Description: "Jo".
   - **Create**, then copy the code.
4. Within those 10 minutes, paste it into Jo's **Grant code** field and tap **Connect**, then **Test**.

You only do this once. If Jo later says the Zoho login expired, repeat step 3 and step 4.

## Step 4: Kavery Delivery and Thirumal (Supabase)

For each app, open its project at https://supabase.com/dashboard → **Project Settings → API keys** (Data API):

| Jo setting | Where to find it |
|---|---|
| **Project URL** | `https://<project-ref>.supabase.co` (Project Settings → Data API) |
| **API key** | the **secret** key (`sb_secret_…`), or the legacy **service_role** key |
| **Tables Jo may read** | e.g. `orders, deliveries, payments, riders`. Leave blank to let Jo see all tables. |
| **Summary function** | optional, see below |

Tap **Test** for each.

**Why the secret key?** Your apps' public (anon/publishable) keys are limited by Row Level Security, which usually hides business data from anyone who isn't logged in, so Jo would see nothing. The secret key can read everything. Jo's code only ever **reads** (it never sends insert, update or delete), and the key is stored encrypted on your phone. Because the secret key could write if it ever leaked, keep your phone locked. If you lose the phone, **rotate the key** in Supabase (API keys → roll/delete).

### Optional: a summary function for a faster, sharper brief

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

## Step 5: Phone settings

- **Allow notifications and calendar** when Jo asks on first launch.
- **On-time morning brief:** phone Settings → Apps → Jo → Battery → **Unrestricted**. On Xiaomi, Redmi, Oppo or Vivo, also turn on **Autostart**.
- **Tamil voice:** Settings → System → Languages → Text-to-speech → Google engine → Install voice data → **Tamil**. Then choose **தமிழ்** in Jo's Settings.
- **Voice input** uses Google's speech recognizer (the Google app must be enabled).

---

## How it works

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
