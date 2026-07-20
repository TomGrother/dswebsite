/**
 * Order Hub admin CLI — create the first admin, add accounts and domain
 * mappings, and (optionally) load demo data for local testing.
 *
 *   node orderhub/seed.js create-admin  <email> <password> ["Display Name"]
 *   node orderhub/seed.js create-customer <email> <password> ["Display Name"]
 *   node orderhub/seed.js map            <domain> <customer_acc_ref>
 *   node orderhub/seed.js override       <email> <customer_acc_ref>
 *   node orderhub/seed.js list
 *   node orderhub/seed.js demo           # sample doors + a demo customer (dev only)
 *
 * On boot, server.js also calls ensureAdminFromEnv(): if PORTAL_ADMIN_EMAIL and
 * PORTAL_ADMIN_PASSWORD are set and that user doesn't exist yet, it's created.
 */
const store = require("./db");
const auth = require("./auth");

async function createUser(role, email, password, name) {
  if (!email || !password) throw new Error(`Usage: create-${role} <email> <password> ["Name"]`);
  const u = await auth.createUser({ email, password, role, display_name: name || null });
  console.log(`Created ${role}: ${u.email} (id ${u.id})`);
}

async function ensureAdminFromEnv() {
  const email = process.env.PORTAL_ADMIN_EMAIL;
  const password = process.env.PORTAL_ADMIN_PASSWORD;
  if (!email || !password) return false;
  const existing = auth.getUserByEmail(email);
  if (existing) {
    // Self-heal: the env-designated admin must always be active staff. If the
    // account already existed as a customer (or got disabled), promote it.
    if (existing.role !== "staff" || !existing.is_active) {
      auth.setRole(existing.id, "staff");
      auth.setActive(existing.id, true);
      console.log(`[orderhub] Promoted ${email.toLowerCase()} to active staff admin from env.`);
      return true;
    }
    return false;
  }
  await auth.createUser({ email, password, role: "staff", display_name: "Admin" });
  console.log(`[orderhub] Created initial staff admin ${email.toLowerCase()} from env.`);
  return true;
}

function demo() {
  const today = new Date();
  const d = (offset) => new Date(today.getTime() + offset * 86400000).toISOString().slice(0, 10);
  const doors = [
    // Order 10432 — Acme (acme.co.uk) — mixed progress incl. on-hold
    { id: 1, order_id: "1001", order_number: "10432", order_ref: "PO-8891", door_type_description: "SR3 Security Doorset — Single Leaf", customer_acc_ref: "ACME01", status_id: 1, complete_punch: 1, complete_bend: 1, complete_weld: 0, complete_buff: 0, complete_paint: 0, complete_pack: 0, date_completion: d(4) },
    { id: 2, order_id: "1001", order_number: "10432", order_ref: "PO-8891", door_type_description: "FD60 Fire Doorset — Double Leaf", customer_acc_ref: "ACME01", status_id: 5, complete_punch: 1, complete_bend: 1, complete_weld: 1, complete_buff: 0, complete_paint: 0, complete_pack: 0, date_completion: d(0) },
    { id: 3, order_id: "1001", order_number: "10432", order_ref: "PO-8891", door_type_description: "Personnel Doorset — Galvanised", customer_acc_ref: "ACME01", status_id: 3, complete_punch: 1, complete_bend: 1, complete_weld: 1, complete_buff: 1, complete_paint: 1, complete_pack: 1, date_completion: d(-2) },
    // Order 10440 — Acme second account ref (ACME02, same domain)
    { id: 4, order_id: "1002", order_number: "10440", order_ref: "PO-8907", door_type_description: "Acoustic Doorset 45dB", customer_acc_ref: "ACME02", status_id: 2, complete_punch: 1, complete_bend: 0, complete_weld: 0, complete_buff: 0, complete_paint: 0, complete_pack: 0, date_completion: d(9) },
    // Order 9001 — a DIFFERENT customer (other.co.uk / OTHER01) — must never be visible to Acme
    { id: 9, order_id: "9001", order_number: "9001", order_ref: "PO-1000", door_type_description: "SR2 Security Doorset", customer_acc_ref: "OTHER01", status_id: 1, complete_punch: 1, complete_bend: 1, complete_weld: 1, complete_buff: 1, complete_paint: 0, complete_pack: 0, date_completion: d(3) },
    // Aged-out packed door (older than window) — must be excluded on read
    { id: 20, order_id: "1000", order_number: "10001", order_ref: "OLD-1", door_type_description: "Old Packed Doorset", customer_acc_ref: "ACME01", status_id: 3, complete_punch: 1, complete_bend: 1, complete_weld: 1, complete_buff: 1, complete_paint: 1, complete_pack: 1, date_completion: d(-120) },
    // Cancelled + removed — must be excluded
    { id: 21, order_id: "1003", order_number: "10450", order_ref: "PO-X", door_type_description: "Cancelled Doorset", customer_acc_ref: "ACME01", status_id: 4, complete_punch: 0, complete_bend: 0, complete_weld: 0, complete_buff: 0, complete_paint: 0, complete_pack: 0, date_completion: d(5) },
  ];
  const { upserted } = store.ingestDoors(doors, { snapshot: true });
  store.pruneAgedOut();
  console.log(`Seeded ${upserted} demo doors (after prune: ${store.doorCount()} in hub).`);
  try { auth.addMapping("acme.co.uk", "ACME01"); auth.addMapping("acme.co.uk", "ACME02"); auth.addMapping("other.co.uk", "OTHER01"); console.log("Mapped acme.co.uk -> ACME01, ACME02 ; other.co.uk -> OTHER01"); } catch (e) { console.log("map:", e.message); }
  console.log("Now create a customer:  node orderhub/seed.js create-customer buyer@acme.co.uk Password123");
}

async function main() {
  const [cmd, a, b, c] = process.argv.slice(2);
  switch (cmd) {
    case "create-admin": await createUser("staff", a, b, c); break;
    case "create-customer": await createUser("customer", a, b, c); break;
    case "set-role": {
      const u = auth.getUserByEmail(a);
      if (!u) throw new Error("No such user: " + a);
      const role = b === "staff" ? "staff" : "customer";
      auth.setRole(u.id, role);
      console.log(`Set ${u.email} role -> ${role}`);
      break;
    }
    case "map": auth.addMapping(a, b); console.log(`Mapped ${a} -> ${b}`); break;
    case "override": {
      const u = auth.getUserByEmail(a);
      if (!u) throw new Error("No such user: " + a);
      auth.addOverride(u.id, b); console.log(`Override: ${a} -> ${b}`); break;
    }
    case "list":
      console.log("Users:"); auth.listUsers().forEach((u) => console.log(`  ${u.role.padEnd(9)} ${u.email} ${u.is_active ? "" : "(disabled)"}`));
      console.log("Mappings:"); auth.listMappings().forEach((m) => console.log(`  ${m.domain} -> ${m.customer_acc_ref}`));
      console.log(`Doors in hub: ${store.doorCount()}`); break;
    case "demo": demo(); break;
    default:
      console.log("Commands: create-admin, create-customer, set-role <email> <staff|customer>, map, override, list, demo");
  }
}

module.exports = { ensureAdminFromEnv };

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error("Error:", e.message); process.exit(1); });
}
