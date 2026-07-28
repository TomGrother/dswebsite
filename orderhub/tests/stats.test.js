/**
 * Login statistics: per-day aggregation for the admin stats page.
 * Run with:  node --test orderhub/tests
 */
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oh-stats-"));
process.env.SESSION_SECRET = "test-secret-stats";

const store = require("../db");

test("recordLogin + loginStatsByDay: per-day logins and distinct users", () => {
  // Two users signing in across two days.
  store.recordLogin({ userId: 1, email: "a@x.co.uk", role: "customer", day: "2026-07-25" });
  store.recordLogin({ userId: 1, email: "a@x.co.uk", role: "customer", day: "2026-07-25" }); // same user again
  store.recordLogin({ userId: 2, email: "b@x.co.uk", role: "customer", day: "2026-07-25" });
  store.recordLogin({ userId: 1, email: "a@x.co.uk", role: "customer", day: "2026-07-26" });

  const byDay = new Map(store.loginStatsByDay(60).map((r) => [r.day, r]));

  assert.strictEqual(byDay.get("2026-07-25").logins, 3, "3 sign-ins on the 25th");
  assert.strictEqual(byDay.get("2026-07-25").users, 2, "2 distinct users on the 25th");
  assert.strictEqual(byDay.get("2026-07-26").logins, 1, "1 sign-in on the 26th");
  assert.strictEqual(byDay.get("2026-07-26").users, 1, "1 distinct user on the 26th");

  // Most-recent-day-first ordering.
  const days = store.loginStatsByDay(60).map((r) => r.day);
  assert.deepStrictEqual(days, ["2026-07-26", "2026-07-25"], "ordered newest day first");
});

test("loginTotals: all-time logins, distinct users, and date range", () => {
  const t = store.loginTotals();
  assert.strictEqual(t.logins, 4, "4 sign-ins total");
  assert.strictEqual(t.users, 2, "2 distinct users total");
  assert.strictEqual(t.first_day, "2026-07-25", "earliest day");
  assert.strictEqual(t.last_day, "2026-07-26", "latest day");
});

test("recordLogin defaults the day to today (Europe/London)", () => {
  store.recordLogin({ userId: 3, email: "c@x.co.uk", role: "staff" });
  const today = store.londonDay();
  const rows = store.loginStatsByDay(90);
  const todayRow = rows.find((r) => r.day === today);
  assert.ok(todayRow && todayRow.logins >= 1, "a login with no explicit day lands on today's London date");
});

test("recentLogins: newest first, capped at n", () => {
  const recent = store.recentLogins(2);
  assert.strictEqual(recent.length, 2, "respects the limit");
  assert.strictEqual(recent[0].email, "c@x.co.uk", "most recent first");
});

test("loginsByUser: one row per user with counts, days and last-seen", () => {
  // Seeded so far: user 1 (3 sign-ins across 2 days), user 2 (1), user 3 (1).
  const rows = store.loginsByUser();
  const byId = new Map(rows.map((r) => [r.user_id, r]));

  assert.strictEqual(byId.get(1).logins, 3, "user 1 has 3 sign-ins");
  assert.strictEqual(byId.get(1).days, 2, "user 1 active on 2 distinct days");
  assert.strictEqual(byId.get(2).logins, 1, "user 2 has 1 sign-in");
  assert.strictEqual(byId.get(3).logins, 1, "user 3 (staff) has 1 sign-in");

  // No app_user rows exist in this test DB, so every user reads as deleted and
  // falls back to the email stored on the event.
  assert.strictEqual(byId.get(2).email, "b@x.co.uk", "falls back to the stored email");
  assert.strictEqual(byId.get(2).deleted, 1, "flags an account with no app_user row");
});
