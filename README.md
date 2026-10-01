# Voice Brief — Karthik's morning voice assistant (Android)

Every morning at 8:00 AM the app collects:

1. **Gmail** — important unread mail from the last day
2. **Thirumal Agency** — the latest Britannia sales-report emails (month-to-date and today's figures)
3. **Kavery app** — whatever your Kavery app's daily-summary endpoint returns

…sends them to the Claude API to write a short spoken briefing, and shows a notification.
Tap the notification and the phone reads the brief aloud (English or Tamil). You can also
tap **Refresh now** any time.

Everything runs on your phone. Nothing goes through Claude.ai — only the Claude API call
that writes the summary.

---

## What you need

- A free **GitHub** account (github.com) — it builds the app for you, so no Android Studio needed
- An Android phone (Android 8 or newer)
- A **Claude API key** from https://console.anthropic.com → API Keys
  (the default model, Claude Haiku 4.5, costs well under ₹1 per brief)
- A **Google Cloud** project for Gmail access (one-time, about 10 minutes — steps below)

---

## Step 1 — Let GitHub build the app

1. On github.com create a new **private** repository, e.g. `voice-brief`.
2. Upload the contents of the unzipped `KarthikVoiceBrief` folder
   (**Add file → Upload files**, drag everything in, including the `.github` folder, **Commit**).
3. Open the **Actions** tab. The "Build APK" job starts by itself and takes about 5 minutes.
4. When it shows a green tick, open it and download **VoiceBrief-apk** at the bottom.
   Unzip it to get `app-debug.apk`.

Every time you change the code and upload again, GitHub builds a new APK.

## Step 2 — Your SHA-1 fingerprint

The project has its own signing key (`app/voicebrief.keystore`), so the fingerprint is
always the same. You'll need it in Step 3:

```
A7:0A:6D:A5:B0:9D:04:82:CD:AF:7B:3C:9A:DB:49:47:C8:0E:BB:44
```

Keep the repository **private** — the key is inside it.

## Step 3 — Set up Gmail access in Google Cloud

1. Go to https://console.cloud.google.com and create a project, e.g. "Voice Brief".
2. **APIs & Services → Library** → search **Gmail API** → **Enable**.
3. **APIs & Services → OAuth consent screen** (may be called "Google Auth Platform"):
   - User type: **External**, app name "Voice Brief", your email as support/contact.
   - **Data access / Scopes**: add `https://www.googleapis.com/auth/gmail.readonly`.
   - **Audience / Test users**: add the Gmail address you want the brief to read.
   - Leave the app in **Testing** mode (fine for personal use).
4. **Credentials → Create credentials → OAuth client ID**:
   - Application type: **Android**
   - Package name: `com.karthik.voicebrief`
   - SHA-1: paste from Step 2
   - Create.

No file to download — Google matches the app by package name + SHA-1.

> Note: in Testing mode Google may ask you to re-approve access about once a week.
> If the brief says Gmail isn't connected, open Settings and tap **Reconnect Gmail**.

## Step 4 — Install on your phone

Send `app-debug.apk` to your phone (WhatsApp to yourself, Google Drive, or USB) and tap it.
Android will ask to allow installs from that app — allow it, then **Install**.
Play Protect may warn that it's an unknown app; choose **Install anyway**.

## Step 5 — Open the app

It opens on the Settings screen.

## Step 6 — First-time setup in the app

1. **Connect Gmail** → pick your account → Allow.
2. Paste your **Claude API key**.
3. **Kavery app**: leave empty for now (see below), or paste its summary URL.
4. Choose **English** or **தமிழ்**, check the time (8:00), tap **Save**.
5. Go back and tap **Refresh now** — you should hear your first brief.

For the 8 AM brief to fire reliably, allow the app to run in the background:
phone **Settings → Apps → Voice Brief → Battery → Unrestricted**
(on Xiaomi/Redmi/Oppo/Vivo also turn on **Autostart**).

For Tamil voice: **Settings → System → Languages → Text-to-speech output →
Google engine → Install voice data → Tamil**.

---

## The Thirumal section

The app reads the **sales-report emails** that land in your Gmail (the ones with Britannia
MTD/today totals). The default search is:

```
newer_than:2d (Britannia OR Thirumal OR "Product Category")
```

Change it in Settings if your report emails use different words — anything that works in
the Gmail search box works here. The app doesn't log into the Britannia DMS portal
itself: that portal has no API and needs a manual login, so emailed reports are the
reliable source. Your earlier automated Britannia report emails are currently paused;
the Thirumal section will say "no report found" until report emails arrive again.

## The Kavery section — endpoint to add in your Kavery app

Add one read-only endpoint to Kavery's backend, e.g. `GET /api/daily-summary`, protected
with a token. Paste the URL and token into the app's Settings. Return plain JSON like:

```json
{
  "date": "2026-09-28",
  "new_orders": 14,
  "pending_orders": 3,
  "new_users": 5,
  "payments_received": 48250,
  "errors_last_24h": 0,
  "notes": ["Delivery partner API was slow between 6 and 7 PM"]
}
```

Any fields are fine — Claude reads whatever you return and turns it into a sentence or two.
The app sends `Authorization: Bearer <token>` if you set a token.

---

## Code map

| File | What it does |
|---|---|
| `MainActivity.kt` | Screens (Home: Play / Refresh; Settings) and the Gmail connect flow |
| `BriefingBuilder.kt` | Collects the three sources and asks Claude for the spoken brief (the prompt lives here) |
| `GmailClient.kt` | Gmail sign-in (read-only) and search |
| `KaveryClient.kt` | Calls the Kavery summary URL |
| `ClaudeClient.kt` | Claude Messages API call |
| `Speaker.kt` | Android text-to-speech (English / Tamil) |
| `BriefingWorker.kt` | Daily 8 AM background job + notification |
| `Settings.kt` | Saved settings; API key and Kavery token are stored encrypted |

To change what the brief says or how long it is, edit `systemPrompt()` in
`BriefingBuilder.kt`.
