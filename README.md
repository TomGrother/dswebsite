# Design & Supply

The public website for [designandsupply.co.uk](https://designandsupply.co.uk) **and** the internal Customer Order Hub, served by one small Express app and deployed to Railway.

- **Marketing site** — static pages built from `partials/` + `public/*.html` via `build.js`, plus an editable **News / Case Studies** CMS (SQLite).
- **Order Hub** — a read-only customer portal to track manufactured doors through production (Punch → Bend → Weld → Buff → Paint → Pack), a staff admin area, and a secured ingest endpoint fed by a scheduled sync from the internal SQL Server.

## Quick start (local)

```bash
npm install
cp .env.example .env          # then edit the values (see below)
npm run build                 # bake header/footer + SEO into public/*.html
npm start                     # http://localhost:3000
```

Node 18+ (developed on Node 24). SQLite via `better-sqlite3`; passwords via `@node-rs/argon2` (both ship prebuilt binaries — no compiler needed).

## Environment variables

See `.env.example`. The important ones:

| Var | What it does |
|-----|--------------|
| `DATA_DIR` | Where the SQLite files live. **On Railway, point at a mounted Volume (e.g. `/data`)** or data is lost on redeploy. |
| `SESSION_SECRET` | Signs Order Hub portal cookies. Required for portal login in production. |
| `INGEST_API_KEY` | Shared secret for the internal sync → `/api/ingest/doors`. |
| `RECENT_DAYS` | Recency window (default 30). Must match `sync/.env`. |
| `PORTAL_ADMIN_EMAIL` / `PORTAL_ADMIN_PASSWORD` | First staff admin, auto-created on boot if absent. |
| `ADMIN_PASSWORD` | Password for the marketing CMS at `/admin`. |
| `SHOP_PASSWORD` | Optional gate for the internal `/shop` pricing tool. |

## Deployment (Railway)

Push to `main`; Railway builds and runs `npm start`. **Before first deploy:** add a Volume mounted at `/data`, set `DATA_DIR=/data`, and set the env vars above. On first boot with an empty volume the app seeds the migrated News/Case Studies content and creates the staff admin from env.

---

# Order Hub

## Data model & access

Production data originates in the internal **SQL Server** (`dbo.door` ⋈ `dbo.door_type`). A scheduled script pushes a **recent, trimmed slice** to the online hub's `orders.db` (SQLite, on the same Railway volume, separate file from the CMS content).

**Access is scoped server-side on every query** (`orderhub/db.js` → `allowedRefsForUser`):

- **Customers** see orders for every `customer_acc_ref` mapped to their **email domain** (`domain_account_map`), unless given explicit **per-user ref overrides** (`user_ref_override`), which then take precedence.
- **Free/shared email domains** (gmail, outlook, …) are blocked from the domain map and scope to nothing — such users must be given explicit overrides, so two unrelated customers can never collide on a shared domain.
- **Staff** see everything.
- Cancelled (`status_id 4`) and Removed (`6`) doors are excluded entirely; Active (`1`) and Query (`2`) both display as "Active"; On Hold (`5`) is badged. Recency window = not-yet-packed **OR** scheduled completion within `RECENT_DAYS`.

## Creating accounts (there is no public sign-up)

Via the admin UI at **`/portal/admin/accounts`**, or the CLI:

```bash
node orderhub/seed.js create-admin    you@designandsupply.co.uk 'StrongPass1'
node orderhub/seed.js create-customer buyer@acme.co.uk 'StrongPass1' 'Acme Buyer'
node orderhub/seed.js map              acme.co.uk ACME01
node orderhub/seed.js map              acme.co.uk ACME02      # a domain can map to many refs
node orderhub/seed.js override         someone@gmail.com CUST99   # per-user ref for a shared domain
node orderhub/seed.js list
node orderhub/seed.js demo             # sample doors + accounts for local testing
```

## Routes

- `/portal/login`, `/portal` (customer order list), `/portal/orders/:orderId`
- `/portal/admin` (staff): dashboard, `/orders` (all customers, filters), `/accounts`, `/mappings`, `/sync` (sync health)
- `POST /api/ingest/doors` — secured by the `x-api-key` header (`INGEST_API_KEY`)

## Internal → online sync

Runs on the **internal network** (has SQL Server access), not on Railway. Reads recent doors and pushes them over HTTPS to the ingest endpoint — the SQL Server is never exposed to the internet.

```bash
cd sync
npm install
cp .env.example .env          # SQL Server connection + HUB_INGEST_URL + INGEST_API_KEY
npm run dry-run               # read + print counts, push nothing
npm start                     # read + push
```

Schedule `node sync/sync.js` every ~15 min via **Windows Task Scheduler** (or cron). It's idempotent: a `snapshot: true` push upserts on `door.id` and deletes anything no longer in the window, keeping the hub trimmed. Each run is recorded and shown at `/portal/admin/sync`.

## Tests

```bash
npm test
```

Covers the security-critical **access scoping** (a customer cannot see another domain's orders; overrides; generic-domain guard; staff-see-all; per-id refusal) and the **recency window** (keep unpacked/recent, drop old-packed/cancelled/removed; on-hold flagging; Active/Query labelling).

## Security notes

- Parameterised queries throughout (no string-built SQL).
- argon2id password hashing; HMAC-signed httpOnly/SameSite session cookies (survive redeploys; user re-checked as active on every request).
- Rate-limited logins; generic login errors (no user enumeration).
- Portal + ingest served `noindex` + `no-store`; ingest gated by a constant-time API-key comparison.
