# Deploying the Order Hub sync

This is the internal script that reads recent doors from the factory SQL Server
and pushes them to the online Order Hub. It runs **on the Design & Supply
network**, not on Railway — the SQL Server is never exposed to the internet, so
the sync reads it on the LAN and pushes out over HTTPS.

## Where it must run

Any **always-on Windows machine** on the office network that can:

1. reach the internal SQL Server host (the one named in `sync/.env`), and
2. make outbound HTTPS (port 443) to `dswebsite-production.up.railway.app`.

A server that's powered on during business hours is ideal. It does **not** need
to be the SQL Server box itself, and nothing inbound is ever opened.

## Prerequisites on that box

- **Node.js 18+** installed (`node -v`). Node's installer adds it to the system
  PATH; if the task's account can't see it, set a `NODE_EXE` env var to the full
  path of `node.exe`.
- A copy of this `sync/` folder, e.g. `C:\Apps\ds-order-sync`.
- `npm install` run inside it (pulls `mssql` + `dotenv` — pure JavaScript, no
  build tools needed).
- **`sync/.env`** present with the real values. This file is git-ignored and
  holds the SQL password, so copy it across manually (never commit it). Use
  `.env.example` as the template.
- A SQL login with **read-only** access to the door tables.

## Install (once, on the box)

1. Copy the folder over, then in an elevated PowerShell inside it:
   ```powershell
   npm install
   node sync.js --dry-run      # reads SQL, prints counts, pushes nothing
   ```
   A healthy dry run prints the door count and a status/date breakdown.
2. Do one real run to confirm the push:
   ```powershell
   node sync.js                # reads SQL and pushes the snapshot
   ```
   Success ends with `Pushed OK — received N, upserted N, removed N`.
3. Register the schedule (prompts for the run-as account's password — not
   stored in any file):
   ```powershell
   .\install-task.ps1
   # or target a specific folder / service account:
   .\install-task.ps1 -SyncDir 'C:\Apps\ds-order-sync' -TaskUser 'DS\svc_ordersync'
   ```

## The schedule

Daily trigger at **07:00**, repeating **every hour for 10 hours** → runs at
07:00, 08:00, …, 17:00 (11 runs/day). Built with these robustness settings:

- **Ignore new** if a run overruns (never stack instances).
- **Start when available** — catch up a run missed while the box was asleep.
- 30-minute execution limit; auto-restart twice on failure.
- Runs whether the account is logged on or not (network-enabled logon).

## Verify & monitor

- **Task Scheduler → Task Scheduler Library → "DS Order Hub Sync"** → History tab
  shows each run and its result; "Last Run Result" `0x0` means success.
- **Logs**: `sync/logs/sync_YYYY-MM-DD.log` — one file per day, 30 days kept,
  each run bracketed by `--- run ... ---` / `--- exit N ---`.
- **Hub side**: every push is recorded in the Order Hub's own sync log, and the
  refreshed doors appear in the portal within a minute.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `SYNC ERROR: ... ELOGIN / failed to connect` | SQL host/user/password in `.env`, or the box can't reach the SQL host on the LAN |
| `Ingest failed 401` | `INGEST_API_KEY` in `.env` doesn't match the hub's key |
| `Ingest failed 404` | `HUB_INGEST_URL` wrong — it must point at the Railway app URL, not the `designandsupply.co.uk` domain |
| Task result `0x1`, empty log | Node not on PATH for the run-as account — set `NODE_EXE` to node.exe's full path |
| Task never fires | Box asleep at the hour and "start when available" disabled, or the account lacks "Log on as a batch job" rights |
