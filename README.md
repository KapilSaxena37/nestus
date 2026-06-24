# NestUs — the real web app

A working hostel & PG finder for students. This is real software: a web server, a
database, search, an owner listing form, and an admin page where you approve listings
before they go live. It has **zero external dependencies** — nothing to install — so it's
as easy as possible to run and put online.

---

## What's inside (so you know what each piece does)

| File / folder | What it does |
|---|---|
| `server.js` | The web server. Runs the site and the API. |
| `db.js` | The database layer. Uses Supabase (permanent) when configured, else a local file. |
| `data/seed.json` | The starter listings the site launches with. |
| `data/db.json` | The live database (created automatically on first run). |
| `public/index.html` | The student site: search, results, listing pages, owner form. |
| `public/admin.html` | Your private admin page to approve/reject listings & see enquiries. |
| `public/app.js`, `public/styles.css` | The site's behaviour and look. |

You don't need to edit any of these to run it.

---

## Part 1 — Run it on your own computer (5 minutes)

You only need **Node.js** (free). It's the engine that runs the app.

1. **Install Node.js** — go to <https://nodejs.org>, download the "LTS" version, install it
   (just keep clicking Next). This is a one-time thing.
2. **Open a terminal** in this `nestus-app` folder:
   - **Mac:** right-click the `nestus-app` folder in Finder → *New Terminal at Folder*.
   - **Windows:** open the folder, click the address bar, type `cmd`, press Enter.
3. **Type this and press Enter:**
   ```
   node server.js
   ```
4. You'll see: `NestUs running at http://localhost:3000`.
5. **Open your browser** and go to **http://localhost:3000** — that's your app!
   - Admin page: **http://localhost:3000/admin.html** — the admin key is `nestus-admin`.

To stop it: click the terminal and press `Ctrl + C`.

### Try the full flow
1. On the site, search Nagpur → open a listing → "Contact owner" → send an enquiry.
2. Go to *List your property*, fill the form, submit. It will **not** appear on the site yet.
3. Open the admin page, enter the key, and **Approve** it — now refresh the site and it's live.

---

## Part 2 — Set up the permanent database (Supabase, free)

This makes sure listings and enquiries are **never lost**. Do this once.

1. Make a free account at <https://supabase.com> → **New project** (pick any name and a
   region close to India, e.g. Mumbai/Singapore). Wait ~2 minutes for it to set up.
2. In the left menu open **SQL Editor** → **New query**, paste the block below, click **Run**:
   ```sql
   create table listings (
     id bigint generated always as identity primary key,
     data jsonb not null
   );
   create table enquiries (
     id bigint generated always as identity primary key,
     data jsonb not null
   );
   ```
3. Get your two keys: left menu **Project Settings → API**. You need:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **service_role key** (under "Project API keys" — click reveal). Keep this secret;
     it only ever lives on the server, never in the browser.

You'll paste these into the host in Part 3 as `SUPABASE_URL` and `SUPABASE_KEY`.
The app seeds the 6 starter listings automatically the first time it connects.

> Want to test Supabase from your own computer first? In your terminal, before
> `node server.js`, run (Mac/Linux):
> ```
> export SUPABASE_URL="https://YOURID.supabase.co"
> export SUPABASE_KEY="your-service_role-key"
> ```
> On startup it should say `Storage: Supabase (permanent)`.

---

## Part 3 — Put it online so real students can use it (nestus.in)

To make it public you "deploy" it to a hosting service. The free, beginner-friendly
option below is **Render**.

### Step A — Put the code on GitHub (free)
1. Make a free account at <https://github.com>.
2. Create a new repository (e.g. `nestus`).
3. Upload this whole `nestus-app` folder (GitHub lets you drag-and-drop files in the browser,
   or use GitHub Desktop if you prefer a click-based tool).

### Step B — Deploy on Render (free)
1. Make a free account at <https://render.com> and connect your GitHub.
2. Click **New → Web Service**, pick your `nestus` repo.
3. Settings:
   - **Build command:** *(leave blank)*
   - **Start command:** `node server.js`
4. Add three **Environment Variables**:
   - `ADMIN_KEY` = *(pick your own secret password for the admin page)*
   - `SUPABASE_URL` = *(your Project URL from Part 2)*
   - `SUPABASE_KEY` = *(your service_role key from Part 2)*
5. Click **Create Web Service**. In a minute you'll get a public link like
   `https://nestus.onrender.com` — that's your live site.

### Step C — Connect your domain nestus.in
1. In Render, open your service → **Settings → Custom Domain → Add** `nestus.in`.
2. Render shows you a DNS record. Log in wherever you bought `nestus.in` (GoDaddy,
   Namecheap, BigRock, etc.) and add that record. It goes live in a few minutes to a few hours.

That's it — `nestus.in` now serves your app.

---

## How data storage works

The app chooses its storage automatically:

- **On your computer** (no Supabase keys set): it saves to `data/db.json`. Simple, but
  this file is only for local testing.
- **Online with Supabase keys set**: it uses your permanent Supabase database — listings
  and enquiries are kept safely and never reset on redeploy.

So once Part 2 + Part 3 are done, your live site is fully data-safe.

---

## What this app does NOT do yet (on purpose — see the MVP Scope doc)

Online booking & deposit payments, reviews & ratings, in-app chat, map view, and mobile
apps are **Phase 2/3**. The plan is to prove students and owners use this first. Everything
here matches the NestUs MVP Scope document.

## Want a change?
Tell me what to add or adjust — new fields, more cities, a different look, a real database,
payments later — and I'll update the code.
