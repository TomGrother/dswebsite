# DesignForce: marketing contacts from the website

**For:** Corey (DesignForce) · **From:** the Design & Supply website · October 2026

## What this is for

The downloads page on designandsupply.co.uk now offers a **specification pack**: a visitor enters their name, email and (optionally) company, and we email them links to every data sheet, certificate and technical document.

The form has an **optional, unticked-by-default** box:

> Yes, send me occasional product news and updates from Design & Supply. You can unsubscribe at any time.

People who tick it have given marketing consent. We'd like those people to land in DesignForce automatically, so they can be included in marketing campaigns. People who don't tick it are **never** sent to DesignForce.

The website side is already built and switched off. It starts sending the moment it is given the endpoint address and a key.

## What we need from DesignForce

One endpoint that adds (or updates) a marketing contact.

```
POST /api/marketing/contacts          (the path is your choice — we store the full URL)
X-API-Key: <a new scoped key, e.g. "MARKETING">
Content-Type: application/json
```

Please use a **new scoped key** that works only on this endpoint, like the existing TRIAGE / READONLY / FUNNEL keys.

### Request body

```json
{
  "external_id": "spec-pack-42",
  "email": "ann@example.co.uk",
  "name": "Ann Smith",
  "company": "Acme Ltd",
  "source": "website-spec-pack",
  "consent": {
    "given": true,
    "text": "Yes, send me occasional product news and updates from Design & Supply. You can unsubscribe at any time.",
    "given_at": "2026-10-24T16:15:25.000Z",
    "method": "Website form opt-in, unticked by default",
    "page": "https://designandsupply.co.uk/downloads"
  },
  "df_ref": "DFREF-Ab3dE5gH9jK1"
}
```

| Field | Notes |
| --- | --- |
| `external_id` | The website's own request id. Unique per request; use it to make retries safe (see below). |
| `email` | Always lower-case. The natural key for the contact. |
| `name` | Full name as typed. |
| `company` | Optional; `null` if not given. Free text — match to an existing company if you can, otherwise store as typed. |
| `source` | Always `website-spec-pack` for now. Useful as an acquisition route ("Marketing"). |
| `consent` | Always `given: true` (we only send consenting people). `text` is the exact wording they ticked; `given_at` is UTC. Please keep this as the consent record. |
| `df_ref` | Present when the visitor arrived from one of your campaign emails (`DFREF-` + the `df_t` id from your tracking script); otherwise `null`. Lets you tie the contact to the campaign recipient. |

### What DesignForce should do

1. **Upsert by email** (case-insensitive).
   - New email → create the contact, marked as consented to marketing, with the consent record and source.
   - Existing contact → don't duplicate. Fill in name/company if they're blank, and record the new consent (a fresh opt-in is valid even if they unsubscribed before — they have just ticked the box again; please log it as a new consent event rather than silently flipping a flag).
2. **Be idempotent on `external_id`.** The website retries after errors and has a manual "send pending" button, so the same `external_id` may arrive more than once. A repeat should return success and change nothing.
3. **Unsubscribes stay in DesignForce.** The website never sends unsubscribes; withdrawal is handled by your campaign unsubscribe link (and the privacy policy tells people they can also reply "unsubscribe" or email sales@).

### Responses

| Status | Body | Meaning |
| --- | --- | --- |
| `201` | `{ "id": 123, "created": true }` | New contact created. |
| `200` | `{ "id": 123, "created": false }` | Existing contact updated, or a repeat of an `external_id` already processed. |
| `400` | `{ "error": "…" }` | Validation failed. The website records the message. |
| `401` | (none) | Wrong or missing key. |

Any 2xx counts as delivered. Anything else (or no answer within 10 seconds) is recorded on the website and retried.

## How the website behaves

- **When:** straight after a consenting visitor submits the form, *after* they've had their response — DesignForce being slow or down never affects the visitor.
- **Retries:** failures are retried automatically (a minute after the site starts, then every six hours), and there's a "Send N to DesignForce" button on the website admin page (`/admin/spec-pack`).
- **Backfill:** people who opted in before the endpoint existed are sent by that same button, once it's connected.
- **Volume:** low — single requests, a handful a day at most.

## Turning it on

1. Corey: deploy the endpoint and create the scoped key.
2. Tom: on Railway (website service) set
   - `DESIGNFORCE_MARKETING_URL` — the full endpoint URL, e.g. `https://<designforce-host>/api/marketing/contacts`
   - `DESIGNFORCE_MARKETING_KEY` — the new key
3. Open `/admin/spec-pack` on the website: it should say **DesignForce: connected**. Press **Send N to DesignForce** once to backfill earlier opt-ins.

## Testing with curl

```bash
curl -X POST "https://<designforce-host>/api/marketing/contacts" \
  -H "X-API-Key: <key>" -H "Content-Type: application/json" \
  -d '{"external_id":"spec-pack-test-1","email":"test@example.com","name":"Test Person","company":null,"source":"website-spec-pack","consent":{"given":true,"text":"Yes, send me occasional product news and updates from Design & Supply. You can unsubscribe at any time.","given_at":"2026-10-24T16:15:25.000Z","method":"Website form opt-in, unticked by default","page":"https://designandsupply.co.uk/downloads"},"df_ref":null}'
```

Sending the same command twice should return `201` then `200`, with one contact in DesignForce.

**Website code:** `specpack.js` (`designforcePayload`, `syncRow`, `syncPending`) in the TomGrother/dswebsite repository.
