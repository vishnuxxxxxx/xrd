# RELAY — Social Media Operations Team Site

A complete frontend, admin console, and backend for a small team that manages
social media accounts on behalf of clients: a public site with a live member
roster, recruitment form, problem-reporting (which notifies a Telegram bot),
biodata, services, and member-ID verification — plus a password-protected
admin console to manage members, statuses, and incoming reports.

**No `npm install` required.** The backend is written with Node's built-in
modules only (`http`, `fs`, `crypto`, native `fetch`), so it runs anywhere
Node 18+ is installed.

## Quick start

```bash
cd relay
node server.js
```

Then open `http://localhost:3000` for the public site and
`http://localhost:3000/admin` for the console.

On first run the server creates a default admin account and prints it to the
console:

```
username: admin
password: ChangeMe123!
```

**Change this immediately:**

```bash
node scripts/set-admin-password.js "your-new-strong-password"
```

You can also change the username at the same time:

```bash
node scripts/set-admin-password.js "your-new-strong-password" your_username
```

## Connecting the Telegram bot

Problem reports (and recruitment applications) are posted to a Telegram chat
via a bot. To enable this:

1. Open Telegram, message **@BotFather**, and run `/newbot`. Copy the token
   it gives you.
2. Decide where reports should land — a DM to you, or a group/channel.
   - **DM:** send the bot any message first (bots can't message you until you
     message them).
   - **Group:** add the bot to the group, then send a message in it.
3. Find the chat ID: visit
   `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser and
   look for `"chat":{"id": ...}` in the response.
4. Copy `.env.example` to `.env` and fill in both values:

```bash
cp .env.example .env
```

```
TELEGRAM_BOT_TOKEN=123456789:AAabcdEFghIJklmnoPQRstuVWxyz
TELEGRAM_CHAT_ID=987654321
```

5. Restart the server. Until these are set, reports/applications are still
   saved and visible in the admin console — they're just logged to the
   server console instead of sent to Telegram, so nothing breaks in the
   meantime.

## What's included

- **`server.js`** — the entire backend: static file serving, session-based
  admin auth (PBKDF2-hashed password, signed cookie sessions), a small
  JSON-file database, and the Telegram integration.
- **`public/index.html` + `public/css/style.css` + `public/js/main.js`** —
  the public site: hero, Biodata, Services, Roster (members), Member ID
  Check, Recruitment form, and Problem Reporting form.
- **`public/admin.html` + `public/css/admin.css` + `public/js/admin.js`** —
  the admin console: login screen, roster management (edit name/role, toggle
  Active/Offline, add/remove members), and views for reports and recruitment
  applications.
- **`data/`** — JSON files acting as the database (`members.json`,
  `admin.json`, `reports.json`, `recruits.json`). Created automatically on
  first run from `members.seed.json`.
- **`scripts/set-admin-password.js`** — CLI to set/reset the admin
  username and password.

## Customizing the roster

The seven starting members in `data/members.seed.json` are placeholders —
replace the `name` and `role` fields with your actual team before first run,
or just edit everyone through the admin console once it's running (faster,
and it's exactly what the console is for). Each member gets a `memberId`
like `RLY-001`, which is what the public Member ID Check looks up.

## Notes for production use

This is built to be simple and dependency-free, which comes with a few
trade-offs worth knowing about before you put it on the open internet:

- **Run it behind HTTPS.** Put it behind a reverse proxy (Caddy, nginx, or
  your host's built-in TLS) so the session cookie and login form aren't sent
  in plaintext.
- **Sessions are in-memory.** Restarting the server logs everyone out, and
  sessions won't be shared across multiple server instances. Fine for a
  single small-team deployment; if you need horizontal scaling, swap in a
  shared session store.
- **The JSON "database" is fine for a small team** (tens to low hundreds of
  members/reports) but isn't built for high concurrency or large datasets.
  If you outgrow it, the `readJSON`/`writeJSON` helpers in `server.js` are
  the only place you'd need to swap out for a real database.
- Consider rate-limiting the public `/api/report`, `/api/recruit`, and
  `/api/verify-id` endpoints if you expect public traffic, to avoid spam or
  brute-forcing member IDs.
