import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { supabase } from "./supabaseClient";

/* ───────────────────────── constants ───────────────────────── */
const ICON_SRC = "/ft-icon.png"; // official Freight Tasker compass mark (public/)

const TYPE_DEFAULTS = { FCL: 500, LCL: 300, AIR: 300, RORO: 1500 };
const TYPES = ["FCL", "LCL", "AIR", "RORO"];

const FREQS = [
  { key: "weekly", label: "Weekly", mult: 52 },
  { key: "fortnightly", label: "Fortnightly", mult: 26 },
  { key: "monthly", label: "Monthly", mult: 12 },
  { key: "quarterly", label: "Quarterly", mult: 4 },
  { key: "yearly", label: "Yearly", mult: 1 },
  { key: "one-off", label: "One-off", mult: 1 },
];
const FREQ_MULT = Object.fromEntries(FREQS.map((f) => [f.key, f.mult]));

/* brand-aligned type colours: navy / blue / green / light blue */
const TYPE_COLOR = { FCL: "#1C3857", LCL: "#009BD6", AIR: "#5FB8E2", RORO: "#72C481" };

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "id" + Math.random().toString(36).slice(2);

/* Currency/locale is user-configurable. CUR is updated from settings at the top of
   each render (synchronous, so all formatting in the same pass uses fresh values). */
const CUR = { locale: "en-AU", currency: "AUD", sym: "$" };
const CURRENCIES = [
  { code: "AUD", locale: "en-AU", label: "AUD — Australian dollar" },
  { code: "USD", locale: "en-US", label: "USD — US dollar" },
  { code: "NZD", locale: "en-NZ", label: "NZD — NZ dollar" },
  { code: "GBP", locale: "en-GB", label: "GBP — Pound sterling" },
  { code: "EUR", locale: "en-IE", label: "EUR — Euro" },
  { code: "SGD", locale: "en-SG", label: "SGD — Singapore dollar" },
  { code: "CAD", locale: "en-CA", label: "CAD — Canadian dollar" },
];
function fmtMoney(n, dp) {
  try {
    return new Intl.NumberFormat(CUR.locale, {
      style: "currency", currency: CUR.currency, currencyDisplay: "narrowSymbol",
      minimumFractionDigits: dp, maximumFractionDigits: dp,
    }).format(n || 0);
  } catch {
    return CUR.sym + (n || 0).toLocaleString(CUR.locale, { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
}
function currencySymbol() {
  try {
    const parts = new Intl.NumberFormat(CUR.locale, { style: "currency", currency: CUR.currency, currencyDisplay: "narrowSymbol" }).formatToParts(0);
    const p = parts.find((x) => x.type === "currency");
    return p ? p.value : "$";
  } catch { return "$"; }
}
const A$ = (n) => fmtMoney(Math.round(n || 0), 0);
const A$2 = (n) => fmtMoney(n || 0, 2);

/* Re-sync the CUR formatting singleton from settings. Called at the top of each
   render so all synchronous formatting in that pass uses the chosen currency.
   Encapsulated here (rather than mutating CUR in the component body) to keep the
   render function free of external mutation. */
function applyCurrency(code) {
  CUR.currency = code || "AUD";
  CUR.locale = (CURRENCIES.find((c) => c.code === CUR.currency) || {}).locale || "en-AU";
  CUR.sym = currencySymbol();
}

/* Derive the sales-rep display name + a stable document code from the signed-in
   user, so the manifest header is correct per user (no hardcoded identity).
   Falls back gracefully when no user is supplied (e.g. preview). */
function repIdentity(user) {
  const email = user?.email || "";
  const metaName = (user?.user_metadata?.full_name || user?.user_metadata?.name || "").trim();
  let name = metaName;
  if (!name && email) {
    name = email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
  }
  const seed = user?.id || email;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) >>> 0;
  const doc = "CP-" + String(seed ? h % 10000 : 42).padStart(4, "0");
  return { name: name || "—", email, doc };
}

/* ───────────────────────── persistence ───────────────────────── */
/* Supabase is the source of truth; localStorage is an offline mirror so the
   app can open (and keep your last figures) even when Supabase is unreachable. */
const LS_PREFIX = "cp-state:";
// Sticky marker: set while the local mirror holds edits that never reached
// Supabase, so a later load prefers the mirror instead of clobbering it with a
// stale remote row. Persisted (not just in-memory) so it survives a tab close
// between an offline edit and the next reconnect.
const LS_PENDING_PREFIX = "cp-pending:";
function readLocal(uid) {
  try { const raw = localStorage.getItem(LS_PREFIX + uid); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}
function writeLocal(uid, state) {
  try { localStorage.setItem(LS_PREFIX + uid, JSON.stringify(state)); } catch { /* quota / disabled */ }
}
function markPending(uid, pending) {
  try {
    if (pending) localStorage.setItem(LS_PENDING_PREFIX + uid, "1");
    else localStorage.removeItem(LS_PENDING_PREFIX + uid);
  } catch { /* quota / disabled */ }
}
function hasPending(uid) {
  try { return localStorage.getItem(LS_PENDING_PREFIX + uid) === "1"; } catch { return false; }
}
async function currentUserId() {
  // getSession reads the cached session from localStorage — no network round-trip,
  // so it still resolves when offline.
  const { data } = await supabase.auth.getSession();
  return data?.session?.user?.id || null;
}

// Set true the moment a sign-out begins, so any in-flight debounced save bails
// out before it can re-write the localStorage mirror we're about to clear (or
// fire a doomed upsert). Reset on each fresh load (i.e. a new sign-in/mount).
let signingOut = false;
// The updated_at of the remote row we last loaded or wrote. Lets a save detect
// when another device/tab has changed the row since (optimistic-concurrency
// check) so the overwrite is surfaced to the user instead of being silent.
let lastSyncedAt = null;

async function loadState() {
  signingOut = false;
  lastSyncedAt = null;
  const uid = await currentUserId();
  if (!uid) return null;
  // Unsynced offline edits: the mirror is newer than remote, so prefer it (and let
  // the normal save flow re-push it) rather than overwriting it with a stale row.
  if (hasPending(uid)) {
    const local = readLocal(uid);
    if (local) return { state: local, pending: true };
  }
  try {
    const { data, error } = await supabase
      .from("projector_state")
      .select("data, updated_at")
      .eq("user_id", uid)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      writeLocal(uid, data.data); // refresh the offline mirror
      markPending(uid, false);    // remote is authoritative now
      lastSyncedAt = data.updated_at || null;
      return { state: data.data, pending: false }; // state -> { accounts, settings, proj, actuals, scenarios }
    }
    // no remote row yet — fall through to any local mirror
  } catch {
    /* offline / unreachable — fall back to the mirror below */
  }
  const local = readLocal(uid);
  return local ? { state: local, pending: hasPending(uid) } : null;
}

// Returns "remote" (saved to Supabase), "conflict" (saved, but the remote had
// been changed by another device since we last synced — overwrite surfaced to the
// user), "local" (mirror only — offline), "auth" (no valid session; NOT saved
// remotely), or false (sign-out in progress).
async function saveState(state) {
  if (signingOut) return false;
  const uid = await currentUserId();
  if (!uid) return "auth";
  writeLocal(uid, state);   // always mirror locally first
  markPending(uid, true);   // assume unsynced until the remote write confirms
  try {
    // Optimistic-concurrency check: has the remote row moved since we last synced?
    // Best-effort only — a failure here must not block the write below.
    let conflict = false;
    try {
      const { data: cur } = await supabase
        .from("projector_state").select("updated_at").eq("user_id", uid).maybeSingle();
      conflict = !!(cur && lastSyncedAt && cur.updated_at !== lastSyncedAt);
    } catch { /* ignore — proceed to write */ }
    const ts = new Date().toISOString();
    const { error } = await supabase
      .from("projector_state")
      .upsert({ user_id: uid, data: state, updated_at: ts });
    if (!error) {
      lastSyncedAt = ts;
      markPending(uid, false);
      return conflict ? "conflict" : "remote";
    }
    // An error could be a network blip OR an expired/invalid session. Check the
    // session so the UI can prompt re-auth instead of falsely claiming the edit
    // was "saved offline" when it will in fact never reach Supabase. The pending
    // marker stays set so the mirror is preferred on the next load.
    const { data } = await supabase.auth.getSession();
    return data?.session ? "local" : "auth";
  } catch {
    return "local";
  }
}

// Clear the offline mirror for the signed-in user before signing out, so
// commission figures don't linger in localStorage on a shared device.
async function signOutClearingMirror() {
  signingOut = true; // block any in-flight debounced save from re-seeding the mirror
  try {
    const uid = await currentUserId();
    if (uid) { localStorage.removeItem(LS_PREFIX + uid); markPending(uid, false); }
  } catch { /* ignore */ }
  await supabase.auth.signOut();
}

const DEFAULT_SETTINGS = { base: 70000, car: 15000, multiplier: 2.5, rate: 10, target: 0, fiscalYearStart: 7, currency: "AUD", tiers: [] };
// Ensure every accelerator band carries a stable id, so React list keys don't
// fall back to the array index (which is unstable when bands are removed). Pure:
// returns a new settings object; tierCommission ignores the id field entirely.
function withTierIds(settings) {
  if (!settings) return settings;
  const tiers = Array.isArray(settings.tiers) ? settings.tiers.map((t) => (t && t.id ? t : { ...t, id: uid() })) : [];
  return { ...settings, tiers };
}
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/* Fiscal-year + "today" awareness. fyStartMonth is 1-12. */
function fiscalInfo(fyStartMonth, today = new Date()) {
  const m = (Number(fyStartMonth) || 1) - 1; // 0-indexed start month
  const y = today.getFullYear();
  let start = new Date(y, m, 1);
  if (today < start) start = new Date(y - 1, m, 1);
  const end = new Date(start.getFullYear() + 1, m, 1);
  const frac = Math.min(1, Math.max(0, (today - start) / (end - start)));
  const quarter = Math.min(4, Math.floor(frac * 4) + 1);
  const sy = start.getFullYear(), ey = end.getFullYear();
  const label = m === 0 ? `${sy}` : `FY${String(sy).slice(2)}/${String(ey).slice(2)}`;
  return { start, end, frac, quarter, label, calendar: m === 0 };
}
const DEFAULT_PROJ = { retention: 85, years: 5, newPerYear: null, newGrowth: 100, payRise: 0, discount: 0 };

/* ── actuals v2 ─────────────────────────────────────────────────────
   Per-account × per-quarter × per-year ledger. Years keyed by FY START
   YEAR (numeric, e.g. 2025) so the key is stable even if fiscalYearStart
   later changes. Each year freezes its own comp snapshot + forecast.
     actuals = {
       v: 2,
       names: { [accId]: "last known name" },     // for orphaned (removed) accounts
       years: {
         [startYear]: {
           comp: { base, car, multiplier, rate, tiers },  // frozen pay snapshot
           forecast: { [accId]: annualGP },         // frozen at year start
           cells: { [accId]: { q1, q2, q3, q4 } },  // realised GP per quarter
         }
       }
     } */
const QKEYS = ["q1", "q2", "q3", "q4"];
const DEFAULT_ACTUALS = { v: 2, names: {}, years: {} };
function migrateActuals(a) {
  if (!a || typeof a !== "object" || a.v !== 2) return { v: 2, names: {}, years: {} };
  return { v: 2, names: a.names || {}, years: a.years || {} };
}
function emptyCells() { return { q1: null, q2: null, q3: null, q4: null }; }
/* short month-range labels for each fiscal quarter, e.g. "Jul–Sep" */
function quarterSpans(fyStartMonth) {
  const m = (Number(fyStartMonth) || 1) - 1;
  return [0, 1, 2, 3].map((q) => `${MONTHS[(m + q * 3) % 12].slice(0, 3)}–${MONTHS[(m + q * 3 + 2) % 12].slice(0, 3)}`);
}
/* fiscal-year label from a start year, e.g. 2025 → "FY25/26" (or "2025" if calendar) */
function fyLabelFor(startYear, fyStartMonth) {
  const m = (Number(fyStartMonth) || 1) - 1;
  if (m === 0) return `${startYear}`;
  return `FY${String(startYear).slice(2)}/${String(startYear + 1).slice(2)}`;
}
const seedAccounts = () => [
  { id: uid(), name: "Weekly China importer", lines: [{ id: uid(), type: "FCL", freq: "weekly", profit: 500 }] },
  { id: uid(), name: "Machinery client", lines: [{ id: uid(), type: "RORO", freq: "monthly", profit: 1500 }] },
];

/* ───────────────────────── engine (pure) ───────────────────────── */
/* Piecewise (marginal) commission across accelerator bands.
   `baseRatePct` applies from the commission line (threshold) up to the first
   tier breakpoint. Each tier = { atMult, rate } sets a new marginal rate above
   `atMult × threshold`. Breakpoints scale with the threshold, so they stay
   meaningful across projection years where the line moves with pay rises.
   With no valid tiers this reduces EXACTLY to the legacy flat calc:
   max(0, gp − threshold) × baseRate — so existing plans are unchanged. */
function tierCommission(gpIn, threshold, baseRatePct, tiers) {
  // Coerce gp to a finite number so corrupt/hand-edited data (e.g. a non-numeric
  // cell value from a restored backup) yields $0 commission, never NaN.
  const gp = Number.isFinite(Number(gpIn)) ? Number(gpIn) : 0;
  const baseRate = (Number(baseRatePct) || 0) / 100;
  const bands = (Array.isArray(tiers) ? tiers : [])
    .map((t) => ({ at: (Number(t.atMult) || 0) * threshold, rate: (Number(t.rate) || 0) / 100 }))
    .filter((t) => Number.isFinite(t.at) && t.at > threshold)
    .sort((a, b) => a.at - b.at);
  if (threshold <= 0 || bands.length === 0) return Math.max(0, gp - threshold) * baseRate;
  const points = [{ at: threshold, rate: baseRate }, ...bands];
  let comm = 0;
  for (let i = 0; i < points.length; i++) {
    const start = points[i].at;
    if (gp <= start) break;
    const end = i + 1 < points.length ? points[i + 1].at : Infinity;
    comm += (Math.min(gp, end) - start) * points[i].rate;
  }
  return comm;
}

/* Inverse of tierCommission: the qualifying GP that yields `targetComm` of
   commission. tierCommission is piecewise-linear and monotonic in GP, so we
   walk the bands, consuming each band's commission capacity until the target
   falls inside one, then solve that segment linearly. Returns Infinity if the
   target is unreachable (e.g. a 0% base with no accelerator). */
function gpForCommission(targetComm, threshold, baseRatePct, tiers) {
  if (!(targetComm > 0)) return threshold;
  const baseRate = (Number(baseRatePct) || 0) / 100;
  const bands = (Array.isArray(tiers) ? tiers : [])
    .map((t) => ({ at: (Number(t.atMult) || 0) * threshold, rate: (Number(t.rate) || 0) / 100 }))
    .filter((t) => Number.isFinite(t.at) && t.at > threshold)
    .sort((a, b) => a.at - b.at);
  if (threshold <= 0 || bands.length === 0) return baseRate > 0 ? threshold + targetComm / baseRate : Infinity;
  const points = [{ at: threshold, rate: baseRate }, ...bands];
  let comm = 0;
  for (let i = 0; i < points.length; i++) {
    const start = points[i].at;
    const end = i + 1 < points.length ? points[i + 1].at : Infinity;
    const rate = points[i].rate;
    if (rate > 0) {
      const cap = end === Infinity ? Infinity : (end - start) * rate;
      if (comm + cap >= targetComm) return start + (targetComm - comm) / rate;
      comm += cap;
    }
  }
  return Infinity;
}

function computeCalc(accounts, settings) {
  const pkg = (Number(settings.base) || 0) + (Number(settings.car) || 0);
  const threshold = pkg * (Number(settings.multiplier) || 0);
  const rate = (Number(settings.rate) || 0) / 100;
  const byType = { FCL: 0, LCL: 0, AIR: 0, RORO: 0 };
  let totalGP = 0;       // committed = included accounts at full value (drives commission)
  let weightedGP = 0;    // confidence-weighted expected GP (included accounts only)
  let oneOffGP = 0;
  let excludedCount = 0;
  const accTotals = {};
  let topName = null, topVal = 0;
  for (const acc of accounts) {
    let at = 0;
    for (const ln of acc.lines) {
      at += (Number(ln.profit) || 0) * (FREQ_MULT[ln.freq] || 0);
    }
    accTotals[acc.id] = at;
    const included = acc.included !== false;
    if (!included) { excludedCount++; continue; }
    const conf = acc.confidence == null ? 100 : Math.max(0, Math.min(100, Number(acc.confidence) || 0));
    for (const ln of acc.lines) {
      const ann = (Number(ln.profit) || 0) * (FREQ_MULT[ln.freq] || 0);
      // Only tally known shipment types so legacy/corrupt data can't spawn a
      // stray key that diverges the per-type breakdown from totalGP.
      if (byType[ln.type] != null) byType[ln.type] += ann;
      if (ln.freq === "one-off") oneOffGP += ann;
    }
    totalGP += at;
    weightedGP += at * (conf / 100);
    if (at > topVal) { topVal = at; topName = acc.name; }
  }
  const recurringGP = totalGP - oneOffGP;
  const concentration = { name: topName, value: topVal, pct: totalGP > 0 ? (topVal / totalGP) * 100 : 0 };
  const over = Math.max(0, totalGP - threshold);
  const commission = tierCommission(totalGP, threshold, settings.rate, settings.tiers);
  const gap = Math.max(0, threshold - totalGP);
  const quarters = [];
  let prevComm = 0;
  for (let q = 1; q <= 4; q++) {
    const cumGP = totalGP * (q / 4);
    const cumComm = tierCommission(cumGP, threshold, settings.rate, settings.tiers);
    quarters.push({ q, cumGP, payment: cumComm - prevComm });
    prevComm = cumComm;
  }
  return { pkg, threshold, rate, totalGP, weightedGP, recurringGP, oneOffGP, over, commission, gap, byType, accTotals, concentration, excludedCount, total: pkg + commission, quarters };
}

function computeProjection(calc, settings, proj) {
  const mult = Number(settings.multiplier) || 0;
  const basePkg = calc.pkg;
  const newPY = proj.newPerYear == null ? calc.totalGP : Number(proj.newPerYear) || 0;
  const ret = (Number(proj.retention) || 0) / 100;
  const growth = (proj.newGrowth == null ? 100 : Number(proj.newGrowth) || 0) / 100;
  const years = Number(proj.years) || 1;
  // Optional inflation/opportunity-cost discount. Year 1 is "today" (undiscounted);
  // each later year's commission is discounted to present value at this rate.
  const disc = (Number(proj.discount) || 0) / 100;
  const rows = [];
  // Only recurring GP carries forward — one-off wins don't repeat.
  let prevRecurring = 0;
  let cumComm = 0;
  let npvComm = 0;
  for (let y = 1; y <= years; y++) {
    const pkg = basePkg + (Number(proj.payRise) || 0) * (y - 1);
    const threshold = pkg * mult;
    const carried = y === 1 ? 0 : prevRecurring * ret;
    const newGP = y === 1 ? calc.totalGP : newPY * Math.pow(growth, y - 1);
    const total = carried + newGP;
    const commission = tierCommission(total, threshold, settings.rate, settings.tiers);
    cumComm += commission;
    const pvComm = disc > 0 ? commission / Math.pow(1 + disc, y - 1) : commission;
    npvComm += pvComm;
    rows.push({ y, pkg, threshold, carried, newGP, total, commission, pvComm, earnings: pkg + commission, cumComm });
    // Year 1's recurring base excludes one-offs; later years are all recurring (carried + new business).
    prevRecurring = y === 1 ? calc.recurringGP : total;
  }
  const max = Math.max(...rows.map((r) => Math.max(r.total, r.threshold)), 1);
  return { rows, cumComm, npvComm, disc, max, newPY };
}

/* ── actuals engine (pure) ──────────────────────────────────────────
   The set of account rows shown for a year = live accounts ∪ any account
   that already has history (a cell value or a frozen forecast) that year.
   Removed-but-historied accounts surface as "orphans" so prior years stay
   intact even after an account is deleted from the working set. */
function accountIdsForYear(yearEntry, accounts) {
  const ids = [];
  const seen = new Set();
  for (const a of accounts) { if (!seen.has(a.id)) { seen.add(a.id); ids.push(a.id); } }
  const extra = new Set();
  if (yearEntry) {
    for (const id of Object.keys(yearEntry.forecast || {})) extra.add(id);
    for (const id of Object.keys(yearEntry.cells || {})) extra.add(id);
  }
  for (const id of extra) if (!seen.has(id)) { seen.add(id); ids.push(id); }
  return ids;
}
/* Compute one fiscal year's actuals. comp/threshold come from the year's
   frozen snapshot (falling back to live settings before a snapshot exists).
   frac = fraction of the CURRENT fiscal year elapsed (0-1) — drives the
   continuous plan-to-date pace line. Past years use the full year (1). */
function computeYear(yearEntry, accounts, names, isCurrent, frac) {
  const entry = yearEntry || { comp: null, forecast: {}, cells: {} };
  const liveById = {};
  for (const a of accounts) liveById[a.id] = a;
  const ids = accountIdsForYear(yearEntry, accounts);
  const comp = entry.comp || null;
  const pkg = comp ? (Number(comp.base) || 0) + (Number(comp.car) || 0) : 0;
  const threshold = comp ? pkg * (Number(comp.multiplier) || 0) : 0;
  const rate = comp ? (Number(comp.rate) || 0) / 100 : 0;

  const perAcc = [];
  let ytd = 0, forecastTotal = 0;
  const qTotals = [0, 0, 0, 0];
  const enteredFlags = [false, false, false, false];
  for (const id of ids) {
    const live = liveById[id];
    const orphan = !live;
    const name = live ? live.name : (names[id] || "Removed account");
    const cells = (entry.cells && entry.cells[id]) || emptyCells();
    const fc = entry.forecast && entry.forecast[id] != null ? Number(entry.forecast[id]) : 0;
    const forecast = Number.isFinite(fc) ? fc : 0;
    // Non-numeric/empty cells read as "not entered" (null). Number.isFinite also
    // rejects NaN from corrupt data so it can't poison ytd/pace/variance.
    const qv = QKEYS.map((k) => {
      if (cells[k] == null || cells[k] === "") return null;
      const n = Number(cells[k]);
      return Number.isFinite(n) ? n : null;
    });
    let sum = 0, hasAny = false;
    qv.forEach((v, i) => {
      if (v != null) { sum += v; qTotals[i] += v; hasAny = true; enteredFlags[i] = true; }
    });
    forecastTotal += forecast;
    ytd += sum;
    perAcc.push({ id, name, orphan, qv, sum, forecast, variance: sum - forecast, hasAny });
  }
  const enteredQ = enteredFlags.filter(Boolean).length;
  // plan-to-date tracks continuous calendar progress through the year, so the
  // pace line rises smoothly instead of jumping a full quarter at a time.
  const progress = isCurrent ? Math.max(0, Math.min(1, frac)) : 1;
  const planToDate = forecastTotal * progress;
  const pace = ytd - planToDate;
  // run-rate: annualise entered quarters; commission applies over threshold.
  const runRate = enteredQ > 0 ? (ytd / enteredQ) * 4 : 0;
  const tiers = comp ? comp.tiers : null;
  const compRate = comp ? comp.rate : 0;
  const commission = tierCommission(ytd, threshold, compRate, tiers);
  const projRunComm = tierCommission(runRate, threshold, compRate, tiers);
  return { ids, perAcc, qTotals, enteredByQ: enteredFlags, ytd, forecastTotal, threshold, pkg, rate, runRate, progress, enteredQ, commission, projRunComm, planToDate, pace, comp };
}
/* Cross-year rollup for the history table. retention = how much of the prior
   year's realised GP carried into this year (realised carry proxy). */
function computeHistory(actuals, accounts, names) {
  const years = Object.keys(actuals.years || {}).map(Number).sort((a, b) => a - b);
  const rows = [];
  let cum = 0, prevActual = null;
  for (const y of years) {
    const entry = actuals.years[y];
    const yd = computeYear(entry, accounts, names, false, 1);
    cum += yd.commission;
    const retention = prevActual && prevActual > 0 ? (yd.ytd / prevActual) * 100 : null;
    rows.push({ y, actual: yd.ytd, threshold: yd.threshold, commission: yd.commission, cum, retention, enteredQ: yd.enteredQ, forecast: yd.forecastTotal });
    prevActual = yd.ytd;
  }
  return { years, rows, cumCommission: cum };
}

/* ───────────────────────── brand mark ───────────────────────── */
function Logo() {
  return (
    <div className="ft-logo">
      <span className="ft-word">Freight</span>
      <img className="ft-logo-img" src={ICON_SRC} alt="Freight Tasker" />
      <span className="ft-word">Tasker</span>
    </div>
  );
}

/* ───────────────────────── compass gauge ─────────────────────────
   The signature "heading to the commission line" instrument. The arc + needle
   map qualifyingGP ÷ threshold across a 180° sweep (left = $0, right = threshold).
   Arc/needle stay azure below the line and switch to green once over. */
function Gauge({ total, threshold }) {
  const ratio = threshold > 0 ? Math.max(0, Math.min(1, total / threshold)) : 0;
  const over = total >= threshold && threshold > 0;
  const accent = over ? "#72C481" : "#009BD6";
  const cx = 140, cy = 150, R = 120, NR = 112; // arc + needle radii
  const rm = 25;                                // compass medallion (pivot) radius
  const theta = (1 - ratio) * Math.PI;          // 0 → left (π), 1 → right (0)
  const ex = cx + R * Math.cos(theta), ey = cy - R * Math.sin(theta);
  const nx = cx + NR * Math.cos(theta), ny = cy - NR * Math.sin(theta);
  const pct = Math.round(ratio * 100);
  return (
    <div className="cp-gauge">
      <svg width="264" height="177" viewBox="0 0 280 188" aria-hidden="true">
        <path d="M20,150 A120,120 0 0 1 260,150" fill="none" stroke="#2F4C6E" strokeWidth="15" strokeLinecap="round" />
        {ratio > 0.001 && (
          <path d={`M20,150 A120,120 0 0 1 ${ex.toFixed(1)},${ey.toFixed(1)}`} fill="none" stroke={accent} strokeWidth="15" strokeLinecap="round" />
        )}
        {/* needle emerges from behind the compass medallion, like a needle on its rose */}
        <line x1={cx} y1={cy} x2={nx.toFixed(1)} y2={ny.toFixed(1)} stroke="#fff" strokeWidth="3" strokeLinecap="round" />
        <circle cx={nx.toFixed(1)} cy={ny.toFixed(1)} r="3.5" fill="#fff" />
        <circle cx={cx} cy={cy} r={rm} fill="#21406a" stroke={accent} strokeWidth="1.5" strokeOpacity="0.55" />
        <image href={ICON_SRC} x={cx - 17} y={cy - 17} width="34" height="34" style={{ filter: "brightness(0) invert(1)", opacity: 0.95 }} />
        <text x="20" y="166" fill="#7FA8C9" fontSize="11" textAnchor="middle">{A$(0)}</text>
        <text x="260" y="166" fill="#7FA8C9" fontSize="11" textAnchor="middle">{A$(threshold)}</text>
      </svg>
      <div className="cp-gauge-read">
        <div className="cp-gauge-pct">{pct}<span>%</span></div>
        <div className="cp-gauge-sub">{A$(total)} of {A$(threshold)}</div>
      </div>
    </div>
  );
}

/* ───────────────────────── component ───────────────────────── */
export default function CommissionProjector({ user } = {}) {
  const [tab, setTab] = useState("year");
  // Arrow-key navigation across the tablist (WAI-ARIA tabs pattern).
  const onTabKey = (e) => {
    const order = ["year", "actuals", "multi", "scenarios"];
    const i = order.indexOf(tab);
    let next = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = order[(i + 1) % order.length];
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = order[(i - 1 + order.length) % order.length];
    else if (e.key === "Home") next = order[0];
    else if (e.key === "End") next = order[order.length - 1];
    if (next) {
      e.preventDefault();
      setTab(next);
      document.getElementById("cp-tab-" + next)?.focus();
    }
  };
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [accounts, setAccounts] = useState(seedAccounts);
  const [proj, setProj] = useState(DEFAULT_PROJ);
  const [actuals, setActuals] = useState(DEFAULT_ACTUALS);
  const [scenarios, setScenarios] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [persisted, setPersisted] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("custom");
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [actYear, setActYear] = useState(null); // selected fiscal-year key (start year) on the Actuals tab

  // In-app dialog (replaces blocking window.confirm/prompt) + toast (with optional Undo).
  // `ask` returns a Promise: confirm dialogs resolve true/false; input dialogs
  // resolve the typed string or null on cancel.
  const [dialog, setDialog] = useState(null);
  const dialogResolve = useRef(null);
  const modalInputRef = useRef(null);
  const ask = (opts) => new Promise((resolve) => { dialogResolve.current = resolve; setDialog(opts); });
  const closeDialog = (result) => { setDialog(null); const r = dialogResolve.current; dialogResolve.current = null; if (r) r(result); };
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const toastAction = useRef(null);
  const showToast = useCallback((message, opts = {}) => {
    clearTimeout(toastTimer.current);
    toastAction.current = opts.onAction || null;
    setToast({ message, actionLabel: opts.actionLabel, kind: opts.kind || "info" });
    toastTimer.current = setTimeout(() => setToast(null), opts.duration || 6000);
  }, []);
  const dismissToast = () => { clearTimeout(toastTimer.current); setToast(null); toastAction.current = null; };
  const runToastAction = () => { const fn = toastAction.current; dismissToast(); if (fn) fn(); };
  useEffect(() => () => {
    clearTimeout(toastTimer.current);
    // Resolve any dialog still awaiting a result (e.g. unmounted via sign-out
    // mid-prompt) so the awaiting caller settles to cancel instead of hanging.
    if (dialogResolve.current) { const r = dialogResolve.current; dialogResolve.current = null; r(null); }
  }, []);

  // Apply currency/locale for this render before any formatting runs.
  applyCurrency(settings.currency);
  const fy = fiscalInfo(settings.fiscalYearStart);
  const rep = repIdentity(user);

  // Set when we hydrate from existing data, so the debounced save effect can skip
  // the one upsert that would otherwise re-write the identical state we just loaded.
  const skipNextSave = useRef(false);
  useEffect(() => {
    loadState().then((res) => {
      const s = res?.state;
      if (s && s.accounts) {
        setAccounts(s.accounts.map((a) => ({ included: true, confidence: 100, ...a })));
        setSettings(withTierIds({ ...DEFAULT_SETTINGS, ...(s.settings || {}) }));
        setProj({ ...DEFAULT_PROJ, ...(s.proj || {}) });
        setActuals(migrateActuals(s.actuals));
        setScenarios(Array.isArray(s.scenarios) ? s.scenarios : []);
        // Skip the echo-save only when the loaded data already matches remote. If it
        // came from an unsynced local mirror, let the save flow re-push it.
        skipNextSave.current = !res.pending;
      }
      setLoaded(true);
    });
  }, []);
  // Latest state blob + a "has unsynced local changes" flag, kept in refs so the
  // reconnect handler can flush without re-subscribing on every keystroke.
  const stateRef = useRef(null);
  useEffect(() => {
    stateRef.current = { accounts, settings, proj, actuals, scenarios };
  });
  const pendingRef = useRef(false);
  const flush = useCallback((ok) => {
    if (ok === "conflict") {
      // The write succeeded, but it overwrote a row another device had changed.
      // Show it as saved, and warn so the overwrite isn't silent.
      setPersisted("remote");
      pendingRef.current = false;
      showToast("This projection was also changed on another device — your version was just saved over it.", { kind: "warn", duration: 8000 });
      return;
    }
    setPersisted(ok);
    pendingRef.current = ok === "local";
  }, [showToast]);

  useEffect(() => {
    if (!loaded) return;
    if (skipNextSave.current) { skipNextSave.current = false; return; }
    const t = setTimeout(() => {
      saveState(stateRef.current).then(flush);
    }, 800);
    return () => clearTimeout(t);
  }, [accounts, settings, proj, actuals, scenarios, loaded, flush]);

  // When connectivity returns, push any offline edits to Supabase.
  useEffect(() => {
    const onReconnect = () => { if (pendingRef.current) saveState(stateRef.current).then(flush); };
    window.addEventListener("online", onReconnect);
    return () => window.removeEventListener("online", onReconnect);
  }, [flush]);

  const calc = useMemo(() => computeCalc(accounts, settings), [accounts, settings]);
  const projection = useMemo(() => computeProjection(calc, settings, proj), [calc, settings, proj]);

  const addAccount = (name) =>
    setAccounts((a) => [...a, { id: uid(), name: name || "New account", included: true, confidence: 100, lines: [{ id: uid(), type: "FCL", freq: "weekly", profit: TYPE_DEFAULTS.FCL }] }]);
  // Accelerator bands: each tier raises the marginal rate above `atMult × line`.
  const tiers = Array.isArray(settings.tiers) ? settings.tiers : [];
  const addTier = () =>
    setSettings((s) => {
      const cur = Array.isArray(s.tiers) ? s.tiers : [];
      const lastMult = cur.length ? Number(cur[cur.length - 1].atMult) || 1 : 1;
      const lastRate = cur.length ? Number(cur[cur.length - 1].rate) || 0 : Number(s.rate) || 0;
      const nextMult = Math.round((Math.max(1, lastMult) + 0.5) * 10) / 10;
      return { ...s, tiers: [...cur, { id: uid(), atMult: nextMult, rate: lastRate + 5 }] };
    });
  const updateTier = (i, patch) =>
    setSettings((s) => ({ ...s, tiers: (Array.isArray(s.tiers) ? s.tiers : []).map((t, j) => (j === i ? { ...t, ...patch } : t)) }));
  const removeTier = (i) =>
    setSettings((s) => ({ ...s, tiers: (Array.isArray(s.tiers) ? s.tiers : []).filter((_, j) => j !== i) }));
  const removeAccount = (id) => {
    const idx = accounts.findIndex((x) => x.id === id);
    if (idx < 0) return;
    const removed = accounts[idx];
    setAccounts((a) => a.filter((x) => x.id !== id));
    showToast(`Removed "${removed.name || "account"}"`, {
      actionLabel: "Undo",
      onAction: () => setAccounts((a) => { const next = a.slice(); next.splice(Math.min(idx, next.length), 0, removed); return next; }),
    });
  };
  const renameAccount = (id, name) => setAccounts((a) => a.map((x) => (x.id === id ? { ...x, name } : x)));
  const setConfidence = (id, v) =>
    setAccounts((a) => a.map((x) => (x.id === id ? { ...x, confidence: v === "" ? 100 : Math.max(0, Math.min(100, Number(v))) } : x)));
  const toggleIncluded = (id) =>
    setAccounts((a) => a.map((x) => (x.id === id ? { ...x, included: x.included === false } : x)));
  const duplicateAccount = (id) =>
    setAccounts((a) => {
      const i = a.findIndex((x) => x.id === id);
      if (i < 0) return a;
      const src = a[i];
      const copy = { ...src, id: uid(), name: src.name + " (copy)", lines: src.lines.map((l) => ({ ...l, id: uid() })) };
      return [...a.slice(0, i + 1), copy, ...a.slice(i + 1)];
    });
  const moveAccount = (id, dir) =>
    setAccounts((a) => {
      const i = a.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= a.length) return a;
      const next = a.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const toggleCollapse = (id) =>
    setCollapsed((c) => { const n = new Set(c); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const setAllCollapsed = (val) =>
    setCollapsed(val ? new Set(accounts.map((a) => a.id)) : new Set());
  const addLine = (id) =>
    setAccounts((a) => a.map((x) => (x.id === id ? { ...x, lines: [...x.lines, { id: uid(), type: "FCL", freq: "weekly", profit: TYPE_DEFAULTS.FCL }] } : x)));
  const updateLine = (aid, lid, patch) =>
    setAccounts((a) =>
      a.map((x) =>
        x.id === aid
          ? { ...x, lines: x.lines.map((l) => { if (l.id !== lid) return l; const next = { ...l, ...patch }; if (patch.type && patch.type !== l.type) next.profit = TYPE_DEFAULTS[patch.type]; return next; }) }
          : x
      )
    );
  const removeLine = (aid, lid) => setAccounts((a) => a.map((x) => (x.id === aid ? { ...x, lines: x.lines.filter((l) => l.id !== lid) } : x)));
  const resetAll = async () => {
    const ok = await ask({ title: "Reset everything?", body: "This clears all accounts and restores default settings.", confirmLabel: "Reset", danger: true });
    if (!ok) return;
    const prev = { accounts, settings, proj };
    setAccounts([]); setSettings(DEFAULT_SETTINGS); setProj(DEFAULT_PROJ);
    showToast("Everything reset", {
      actionLabel: "Undo",
      onAction: () => { setAccounts(prev.accounts); setSettings(prev.settings); setProj(prev.proj); },
    });
  };

  const fcLboxes = Math.ceil(calc.gap / (TYPE_DEFAULTS.FCL * 52)) || 0;
  const roroUnits = Math.ceil(calc.gap / (TYPE_DEFAULTS.RORO * 12)) || 0;
  const lastRow = projection.rows[projection.rows.length - 1] || { total: 0, commission: 0 };

  /* search + quick-add */
  const q = query.trim().toLowerCase();
  const visibleAccounts = q ? accounts.filter((a) => (a.name || "").toLowerCase().includes(q)) : accounts;
  const sorted = sort !== "custom";
  const displayAccounts = !sorted ? visibleAccounts : visibleAccounts.slice().sort((a, b) => {
    const gpA = calc.accTotals[a.id] || 0, gpB = calc.accTotals[b.id] || 0;
    const nA = (a.name || "").toLowerCase(), nB = (b.name || "").toLowerCase();
    switch (sort) {
      case "gp-desc": return gpB - gpA;
      case "gp-asc": return gpA - gpB;
      case "name-asc": return nA.localeCompare(nB);
      case "name-desc": return nB.localeCompare(nA);
      default: return 0;
    }
  });
  const quickAdd = () => { const name = query.trim(); if (!name) return; addAccount(name); setQuery(""); };
  const allCollapsed = accounts.length > 0 && accounts.every((a) => collapsed.has(a.id));

  /* target */
  const targetAmt = Number(settings.target) || 0;
  const gpForTarget = gpForCommission(targetAmt, calc.threshold, settings.rate, settings.tiers);
  const targetReachable = Number.isFinite(gpForTarget);
  const gpToTarget = targetReachable ? Math.max(0, gpForTarget - calc.totalGP) : 0;
  // Goal-seek: translate the GP still needed for the target into tangible volume.
  const targetFcl = Math.ceil(gpToTarget / (TYPE_DEFAULTS.FCL * 52)) || 0;
  const targetRoro = Math.ceil(gpToTarget / (TYPE_DEFAULTS.RORO * 12)) || 0;

  /* ── actuals & pace (v2) ── */
  const curQ = fy.quarter; // current fiscal quarter
  const curYearKey = fy.start.getFullYear(); // FY start year of "today"
  const activeYear = actYear ?? curYearKey;
  const isCurrentYear = activeYear === curYearKey;
  const qSpans = quarterSpans(settings.fiscalYearStart);

  // last-known names: live names win, fall back to the saved registry for orphans.
  const names = useMemo(() => {
    const m = { ...(actuals.names || {}) };
    for (const a of accounts) m[a.id] = a.name;
    return m;
  }, [actuals.names, accounts]);

  // snapshot of the current live forecast/comp — used to seed a new year entry.
  const liveForecast = useMemo(() => {
    const f = {};
    for (const a of accounts) if (a.included !== false) f[a.id] = calc.accTotals[a.id] || 0;
    return f;
  }, [accounts, calc.accTotals]);
  const liveComp = useMemo(
    () => ({ base: Number(settings.base) || 0, car: Number(settings.car) || 0, multiplier: Number(settings.multiplier) || 0, rate: Number(settings.rate) || 0, tiers: Array.isArray(settings.tiers) ? settings.tiers : [] }),
    [settings.base, settings.car, settings.multiplier, settings.rate, settings.tiers]
  );

  const yearEntry = actuals.years ? actuals.years[activeYear] : null;
  const fyFrac = fy.frac;
  const yearData = useMemo(
    () => computeYear(yearEntry, accounts, names, isCurrentYear, fyFrac),
    [yearEntry, accounts, names, isCurrentYear, fyFrac]
  );
  const history = useMemo(() => computeHistory(actuals, accounts, names), [actuals, accounts, names]);
  const yearKeys = useMemo(() => {
    const set = new Set(Object.keys(actuals.years || {}).map(Number));
    set.add(curYearKey);
    return Array.from(set).sort((a, b) => a - b);
  }, [actuals.years, curYearKey]);
  const snapshotAt = yearEntry && yearEntry.snapshotAt ? yearEntry.snapshotAt : null;
  const liveForecastTotal = useMemo(() => Object.values(liveForecast).reduce((s, v) => s + (Number(v) || 0), 0), [liveForecast]);
  // nudge: on the live year, flag when the working forecast has drifted from the
  // frozen snapshot (e.g. just after a fiscal-year rollover, once accounts change).
  const snapshotDrift = isCurrentYear && yearEntry && Math.round(liveForecastTotal) !== Math.round(yearData.forecastTotal);

  // Ensure the current fiscal year always has an entry (frozen at first open).
  useEffect(() => {
    if (!loaded || tab !== "actuals") return;
    // Seeds this fiscal year's snapshot once when the Actuals tab is first opened.
    // This is a deliberate one-time external-state seed, not a render-driven sync.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActuals((a) => {
      if (a.years && a.years[curYearKey]) return a;
      return { ...a, years: { ...(a.years || {}), [curYearKey]: { comp: liveComp, forecast: liveForecast, cells: {}, snapshotAt: new Date().toISOString() } } };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, tab, curYearKey]);

  /* actuals actions */
  const setCell = (year, id, qk, val) =>
    setActuals((a) => {
      const years = { ...(a.years || {}) };
      const entry = { ...(years[year] || { comp: liveComp, forecast: { ...liveForecast }, cells: {} }) };
      const cells = { ...(entry.cells || {}) };
      const row = { ...(cells[id] || emptyCells()) };
      row[qk] = val === "" || val == null ? null : Number(val);
      cells[id] = row;
      entry.cells = cells;
      // remember the name so a later removal still renders this row.
      const live = accounts.find((x) => x.id === id);
      const nm = { ...(a.names || {}) };
      if (live) nm[id] = live.name;
      years[year] = entry;
      return { ...a, years, names: nm };
    });
  const setYearComp = (year, patch) =>
    setActuals((a) => {
      const years = { ...(a.years || {}) };
      const entry = { ...(years[year] || { comp: liveComp, forecast: { ...liveForecast }, cells: {} }) };
      entry.comp = { ...(entry.comp || liveComp), ...patch };
      years[year] = entry;
      return { ...a, years };
    });
  const reSnapshot = async (year) => {
    const ok = await ask({ title: "Re-freeze this year?", body: "Re-snapshots this year's forecast and pay package from your current working figures. Entered actuals are kept.", confirmLabel: "Re-freeze" });
    if (!ok) return;
    setActuals((a) => {
      const years = { ...(a.years || {}) };
      const entry = { ...(years[year] || { cells: {} }) };
      entry.comp = liveComp;
      entry.forecast = { ...liveForecast };
      entry.snapshotAt = new Date().toISOString();
      years[year] = entry;
      return { ...a, years };
    });
  };
  const addYear = (year) =>
    setActuals((a) => {
      if (a.years && a.years[year]) return a;
      return { ...a, years: { ...(a.years || {}), [year]: { comp: liveComp, forecast: { ...liveForecast }, cells: {}, snapshotAt: new Date().toISOString() } } };
    });
  const addNextYear = () => {
    const next = (yearKeys[yearKeys.length - 1] || curYearKey) + 1;
    addYear(next);
    setActYear(next);
  };
  const deleteYear = async (year) => {
    const label = fyLabelFor(year, settings.fiscalYearStart);
    const removed = actuals.years ? actuals.years[year] : null;
    const ok = await ask({ title: `Delete ${label}?`, body: "Removes all entered actuals and the frozen snapshot for this fiscal year.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    setActuals((a) => {
      const years = { ...(a.years || {}) };
      delete years[year];
      return { ...a, years };
    });
    setActYear(null);
    showToast(`Deleted ${label}`, {
      actionLabel: "Undo",
      onAction: () => { if (removed) setActuals((a) => ({ ...a, years: { ...(a.years || {}), [year]: removed } })); setActYear(year); },
    });
  };

  /* scenarios */
  const saveScenario = async () => {
    const name = await ask({ title: "Save scenario", body: "Name this snapshot of your current accounts, settings & forecast.", input: true, defaultValue: "Scenario " + (scenarios.length + 1), confirmLabel: "Save" });
    if (!name) return;
    setScenarios((s) => [...s, { id: uid(), name, savedAt: new Date().toISOString(), data: { accounts, settings, proj } }]);
    showToast(`Saved "${name}"`);
  };
  const loadScenario = async (sc) => {
    const prev = { accounts, settings, proj };
    const ok = await ask({ title: `Load "${sc.name}"?`, body: "This replaces your current working figures (accounts, settings & forecast).", confirmLabel: "Load" });
    if (!ok) return;
    setAccounts(sc.data.accounts || []);
    setSettings(withTierIds({ ...DEFAULT_SETTINGS, ...(sc.data.settings || {}) }));
    setProj({ ...DEFAULT_PROJ, ...(sc.data.proj || {}) });
    setTab("year");
    showToast(`Loaded "${sc.name}"`, {
      actionLabel: "Undo",
      onAction: () => { setAccounts(prev.accounts); setSettings(prev.settings); setProj(prev.proj); },
    });
  };
  const deleteScenario = (id) => setScenarios((s) => s.filter((x) => x.id !== id));

  /* export / print */
  const exportCSV = () => {
    const head = ["Year", "Package", "Threshold", "Carried", "New", "Total GP", "Commission", "Earnings"];
    const lines = projection.rows.map((r) =>
      [r.y, r.pkg, r.threshold, r.carried, r.newGP, r.total, r.commission, r.earnings].map((n) => Math.round(n)).join(","));
    const csv = [head.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "commission-forecast.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  /* ── backup / restore / actuals export ── */
  const downloadFile = (name, mime, text) => {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };
  // Full snapshot of everything — your insurance copy. Re-importable via restoreBackup.
  const exportBackup = () => {
    const payload = { _backup: { app: "commission-projector", schema: 2, exportedAt: new Date().toISOString() }, accounts, settings, proj, actuals, scenarios };
    downloadFile(`commission-projector-backup-${new Date().toISOString().slice(0, 10)}.json`, "application/json", JSON.stringify(payload, null, 2));
  };
  const restoreBackup = () => {
    if (typeof document === "undefined") return;
    const input = document.createElement("input");
    input.type = "file"; input.accept = "application/json,.json";
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        let parsed;
        try { parsed = JSON.parse(String(reader.result)); }
        catch { showToast("That file isn't valid JSON — restore cancelled.", { kind: "error" }); return; }
        if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.accounts)) {
          showToast("This doesn't look like a Commission Projector backup — restore cancelled.", { kind: "error" }); return;
        }
        const ok = await ask({ title: "Restore this backup?", body: "It replaces ALL current accounts, settings, and year-on-year history. Consider downloading a backup first.", confirmLabel: "Restore", danger: true });
        if (!ok) return;
        setAccounts((parsed.accounts || []).map((a) => ({ included: true, confidence: 100, ...a })));
        setSettings(withTierIds({ ...DEFAULT_SETTINGS, ...(parsed.settings || {}) }));
        setProj({ ...DEFAULT_PROJ, ...(parsed.proj || {}) });
        setActuals(migrateActuals(parsed.actuals));
        setScenarios(Array.isArray(parsed.scenarios) ? parsed.scenarios : []);
        setActYear(null); setTab("year");
        showToast("Backup restored.");
      };
      reader.readAsText(file);
    };
    input.click();
  };
  // Long-form actuals: one row per account per tracked year, for Excel/archiving.
  const exportActualsCSV = () => {
    const csvCell = (s) => {
      let v = String(s == null ? "" : s);
      // Guard against CSV formula injection: a leading =,+,-,@,tab,CR makes some
      // spreadsheets execute the cell as a formula. Prefix with a single quote.
      if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    const yrs = Object.keys(actuals.years || {}).map(Number).sort((a, b) => a - b);
    const head = ["FY start year", "FY label", "Account", "Status", "Forecast", "Q1", "Q2", "Q3", "Q4", "Year actual", "Variance vs forecast", "Threshold", "Commission"];
    const rows = [];
    for (const y of yrs) {
      const yd = computeYear(actuals.years[y], accounts, names, false, 1);
      const lbl = fyLabelFor(y, settings.fiscalYearStart);
      for (const r of yd.perAcc) {
        const q = (i) => (r.qv[i] == null ? "" : Math.round(r.qv[i]));
        rows.push([y, csvCell(lbl), csvCell(r.name), r.orphan ? "removed" : "active", Math.round(r.forecast),
          q(0), q(1), q(2), q(3), r.hasAny ? Math.round(r.sum) : "", r.hasAny ? Math.round(r.variance) : "",
          Math.round(yd.threshold), Math.round(yd.commission)].join(","));
      }
    }
    downloadFile(`actuals-history-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8", [head.join(","), ...rows].join("\n"));
  };

  const printView = () => { if (typeof window !== "undefined") window.print(); };

  return (
    <div className="cp-root">
      <style>{CSS}</style>

      <header className="cp-header">
        <Logo />
        <div className="cp-head-actions">
          <span aria-live="polite" className={"cp-save " + (persisted === "remote" ? "ok" : persisted == null ? "off" : persisted === "auth" ? "err" : "warn")}>
            <i className="cp-save-dot" />{persisted == null || persisted === "remote" ? "Saved" : persisted === "auth" ? "Session expired · sign in again to save" : "Saved offline · will sync when back online"}
          </span>
          <button className="cp-btn primary" onClick={() => setShowSettings((s) => !s)}>{showSettings ? "Close settings" : "Settings"}</button>
          <button className="cp-btn" onClick={printView}>Manifest PDF</button>
          <button className="cp-btn" onClick={() => signOutClearingMirror()}>Sign out</button>
        </div>
      </header>

      {/* B2 — print-only one-page Commission Manifest (Print / Save as PDF) */}
      <section className="cp-manifest" aria-hidden="true">
        <div className="cp-mf-head">
          <div className="cp-mf-brand"><span className="cp-mf-ft">Freight Tasker</span><span className="cp-mf-doc">Commission Manifest</span></div>
          <div className="cp-mf-meta">
            <div><span>Document</span><b>{rep.doc}</b></div>
            <div><span>Fiscal year</span><b>{fy.label}</b></div>
            <div><span>Sales rep</span><b>{rep.name}</b></div>
            <div><span>Generated</span><b>{new Date().toLocaleDateString(CUR.locale, { day: "numeric", month: "short", year: "numeric" })}</b></div>
          </div>
        </div>

        <div className="cp-mf-cols">
          <div className="cp-mf-block">
            <h3>Compensation basis</h3>
            <dl>
              <div><dt>Base salary</dt><dd>{A$(settings.base)}</dd></div>
              <div><dt>Car allowance</dt><dd>{A$(settings.car)}</dd></div>
              <div><dt>Package</dt><dd>{A$(calc.pkg)}</dd></div>
              <div><dt>Threshold multiplier</dt><dd>×{settings.multiplier || 0}</dd></div>
              <div><dt>Commission threshold</dt><dd>{A$(calc.threshold)}</dd></div>
              <div><dt>Commission rate</dt><dd>{settings.rate || 0}%{tiers.length ? " + accelerators" : ""}</dd></div>
            </dl>
            {tiers.length > 0 && (
              <div className="cp-mf-bands">
                <div className="cp-mf-band"><span>From the line ({A$(calc.threshold)})</span><b>{settings.rate || 0}%</b></div>
                {tiers.map((t, i) => (
                  <div className="cp-mf-band" key={t.id ?? i}><span>Above {A$(calc.threshold * (Number(t.atMult) || 0))} ({(Number(t.atMult) || 0)}×)</span><b>{Number(t.rate) || 0}%</b></div>
                ))}
              </div>
            )}
          </div>

          <div className="cp-mf-block">
            <h3>This year's projection</h3>
            <dl>
              <div><dt>Forecast GP</dt><dd>{A$(calc.totalGP)}</dd></div>
              <div><dt>Over the line</dt><dd>{A$(calc.over)}</dd></div>
              <div className="hi"><dt>Projected commission</dt><dd>{A$(calc.commission)}</dd></div>
              <div><dt>Total earnings</dt><dd>{A$(calc.total)}</dd></div>
              {targetAmt > 0 && (
                <div><dt>Commission target</dt><dd>{A$(targetAmt)} · {calc.commission >= targetAmt ? "met" : targetReachable ? A$(Math.max(0, gpForTarget - calc.totalGP)) + " GP to go" : "out of reach"}</dd></div>
              )}
            </dl>
          </div>
        </div>

        <div className="cp-mf-block wide">
          <h3>Multi-year outlook · {proj.years || projection.rows.length} years{proj.payRise ? ` · ${A$(proj.payRise)}/yr pay rise` : ""}{projection.disc > 0 ? ` · ${proj.discount}% discount` : ""}</h3>
          <table className="cp-mf-table">
            <thead>
              <tr>
                <th>Year</th><th className="n">Package</th><th className="n">Forecast GP</th><th className="n">Threshold</th><th className="n">Commission</th>{projection.disc > 0 && <th className="n">Present value</th>}<th className="n">Total earnings</th>
              </tr>
            </thead>
            <tbody>
              {projection.rows.map((r) => (
                <tr key={r.y}>
                  <td>Year {r.y}</td>
                  <td className="n">{A$(r.pkg)}</td>
                  <td className="n">{A$(r.total)}</td>
                  <td className="n">{A$(r.threshold)}</td>
                  <td className="n">{A$(r.commission)}</td>
                  {projection.disc > 0 && <td className="n">{A$(r.pvComm)}</td>}
                  <td className="n">{A$(r.earnings)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Cumulative</td>
                <td className="n" colSpan={3}></td>
                <td className="n">{A$(projection.cumComm)}</td>
                {projection.disc > 0 && <td className="n">{A$(projection.npvComm)}</td>}
                <td className="n"></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p className="cp-mf-foot">Indicative projection generated by the Freight Tasker Commission Projector. Figures are estimates based on entered forecasts and current compensation settings, not a guarantee of earnings. Confidential.</p>
      </section>

      <div className="cp-meta">
        <div className="cp-meta-cell"><div className="cp-meta-label">Document</div><div className="cp-meta-val">{rep.doc} · {fy.label}</div></div>
        <div className="cp-meta-cell"><div className="cp-meta-label">Sales rep</div><div className="cp-meta-val" title={rep.email}>{rep.name}</div></div>
        <div className="cp-meta-cell"><div className="cp-meta-label">Elapsed</div><div className="cp-meta-val">{Math.round(fy.frac * 100)}% of period</div></div>
        <div className="cp-meta-cell status">
          <span className={"cp-status " + (calc.commission > 0 ? "above" : "")}>Status · {calc.commission > 0 ? "Above line" : "Below line"}</span>
        </div>
      </div>

      <div className="cp-eyebrow">Sales commission manifest</div>
      <div className="cp-titlerow">
        <h1 className="cp-title">Commission Projector</h1>
        <nav className="cp-tabs" role="tablist" aria-label="View" onKeyDown={onTabKey}>
          <button role="tab" id="cp-tab-year" aria-controls="cp-panel-year" aria-selected={tab === "year"} tabIndex={tab === "year" ? 0 : -1} className={tab === "year" ? "on" : ""} onClick={() => setTab("year")}>This year</button>
          <button role="tab" id="cp-tab-actuals" aria-controls="cp-panel-actuals" aria-selected={tab === "actuals"} tabIndex={tab === "actuals" ? 0 : -1} className={tab === "actuals" ? "on" : ""} onClick={() => setTab("actuals")}>Actuals &amp; pace</button>
          <button role="tab" id="cp-tab-multi" aria-controls="cp-panel-multi" aria-selected={tab === "multi"} tabIndex={tab === "multi" ? 0 : -1} className={tab === "multi" ? "on" : ""} onClick={() => setTab("multi")}>Multi-year</button>
          <button role="tab" id="cp-tab-scenarios" aria-controls="cp-panel-scenarios" aria-selected={tab === "scenarios"} tabIndex={tab === "scenarios" ? 0 : -1} className={tab === "scenarios" ? "on" : ""} onClick={() => setTab("scenarios")}>Scenarios</button>
        </nav>
      </div>

      {showSettings && (
        <section className="cp-settings">
          <Field label="Base salary"><Money value={settings.base} onChange={(v) => setSettings((s) => ({ ...s, base: v }))} /></Field>
          <Field label="Car allowance"><Money value={settings.car} onChange={(v) => setSettings((s) => ({ ...s, car: v }))} /></Field>
          <Field label="Threshold multiplier"><input className="cp-input" type="number" step="0.1" placeholder="0" value={settings.multiplier ?? ""} onChange={(e) => setSettings((s) => ({ ...s, multiplier: e.target.value === "" ? "" : Number(e.target.value) }))} onBlur={(e) => { if (e.target.value === "") setSettings((s) => ({ ...s, multiplier: 0 })); }} /></Field>
          <Field label="Commission rate %"><input className="cp-input" type="number" step="0.5" placeholder="0" value={settings.rate ?? ""} onChange={(e) => setSettings((s) => ({ ...s, rate: e.target.value === "" ? "" : Number(e.target.value) }))} onBlur={(e) => { if (e.target.value === "") setSettings((s) => ({ ...s, rate: 0 })); }} /></Field>
          <Field label="Annual commission target"><Money value={settings.target} onChange={(v) => setSettings((s) => ({ ...s, target: v }))} /></Field>
          <Field label="Fiscal year starts">
            <select className="cp-input" value={settings.fiscalYearStart} onChange={(e) => setSettings((s) => ({ ...s, fiscalYearStart: Number(e.target.value) }))}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </Field>
          <Field label="Currency">
            <select className="cp-input" value={settings.currency} onChange={(e) => setSettings((s) => ({ ...s, currency: e.target.value }))}>
              {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </Field>
          <div className="cp-tiers">
            <div className="cp-tiers-head">
              <div>
                <b>Accelerator bands</b>
                <span className="cp-tiers-sub">Marginal rates above the commission line. Leave empty for a flat {settings.rate || 0}%.</span>
              </div>
              <button className="cp-btn" onClick={addTier}>+ Add band</button>
            </div>
            <div className="cp-tier-row cp-tier-base">
              <span className="cp-tier-label">From the line <em>({A$(calc.threshold)})</em></span>
              <span className="cp-tier-rate">{settings.rate || 0}%</span>
              <span className="cp-tier-x" />
            </div>
            {tiers.map((t, i) => (
              <div className="cp-tier-row" key={t.id ?? i}>
                <span className="cp-tier-label">
                  Above
                  <input className="cp-tier-mult" type="number" step="0.1" min="1" placeholder="1.5" value={t.atMult ?? ""}
                    onChange={(e) => updateTier(i, { atMult: e.target.value === "" ? "" : Number(e.target.value) })}
                    onBlur={(e) => { if (e.target.value === "") updateTier(i, { atMult: 1 }); }} />
                  × the line <em>({A$(calc.threshold * (Number(t.atMult) || 0))})</em>
                </span>
                <span className="cp-tier-rate">
                  <input className="cp-tier-pct" type="number" step="0.5" placeholder="0" value={t.rate ?? ""}
                    onChange={(e) => updateTier(i, { rate: e.target.value === "" ? "" : Number(e.target.value) })}
                    onBlur={(e) => { if (e.target.value === "") updateTier(i, { rate: 0 }); }} />%
                </span>
                <button className="cp-tier-x cp-x sm" aria-label="Remove band" onClick={() => removeTier(i)}>×</button>
              </div>
            ))}
          </div>
          <div className="cp-settings-note">
            Package <b>{A$(calc.pkg)}</b> × {settings.multiplier} = <b>{A$(calc.threshold)}</b> threshold · {tiers.length ? `tiered from ${settings.rate || 0}%` : `${settings.rate}% on every dollar over`}.
            <button className="cp-reset" onClick={resetAll}>Reset all</button>
          </div>
          <div className="cp-data-row">
            <div className="cp-data-text"><b>Backup &amp; restore.</b> Your data lives in one cloud record. Download a dated copy for safekeeping, or restore from a previous file.</div>
            <div className="cp-data-actions">
              <button className="cp-btn" onClick={exportBackup}>Download backup</button>
              <button className="cp-btn" onClick={restoreBackup}>Restore…</button>
            </div>
          </div>
        </section>
      )}

      {/* ════════════ TAB 1 ════════════ */}
      {tab === "year" && (
        <div className="cp-tabpanel" role="tabpanel" id="cp-panel-year" aria-labelledby="cp-tab-year" tabIndex={-1}>
          <section className="cp-hero">
            <div className="cp-instr">
              <img className="cp-instr-mark" src={ICON_SRC} alt="" aria-hidden="true" />
              <div className="cp-instr-label">Heading to the commission line</div>
              <Gauge total={calc.totalGP} threshold={calc.threshold} />
              <div className="cp-instr-headline">
                <div>
                  <div className="cp-instr-eyebrow">Projected commission</div>
                  <div className="cp-instr-comm">{A$(calc.commission)}</div>
                </div>
                <span className={"cp-linechip " + (calc.over > 0 ? "above" : "")}>{calc.over > 0 ? "Above line" : "Below line"}</span>
              </div>
            </div>
            <div className="cp-readouts">
              <div className="cp-readout">
                <div><div className="cp-readout-label">Qualifying GP</div><div className="cp-readout-sub">committed</div></div>
                <div className="cp-readout-val">{A$(calc.totalGP)}</div>
              </div>
              <div className="cp-readout">
                <div><div className="cp-readout-label">Threshold · {settings.multiplier}×</div><div className="cp-readout-sub">package basis</div></div>
                <div className="cp-readout-val">{A$(calc.threshold)}</div>
              </div>
              <div className="cp-readout">
                <div><div className="cp-readout-label">Total earnings</div><div className="cp-readout-sub">package + commission</div></div>
                <div className="cp-readout-val">{A$(calc.total)}</div>
              </div>
            </div>
          </section>

          <section className="cp-track-wrap">
            <div className="cp-tape-head"><span className="cp-tape-title">Distance to commission line</span><span className="cp-tape-rem">{calc.gap > 0 ? A$(calc.gap) + " remaining" : A$(calc.over) + " over"}</span></div>
            <Track threshold={calc.threshold} total={calc.totalGP} />
            <div className="cp-track-caption">
              {calc.gap > 0 ? (
                <><b>{A$(calc.gap)}</b> to the commission line — about <b>{fcLboxes}</b> more weekly FCL {fcLboxes === 1 ? "box" : "boxes"} or <b>{roroUnits}</b> monthly RORO {roroUnits === 1 ? "unit" : "units"}.</>
              ) : (
                <><b>{A$(calc.over)}</b> over the line, earning <b className="pos">{A$(calc.commission)}</b> at {settings.rate}%{tiers.length ? " + accelerators" : ""}.</>
              )}
            </div>
            {targetAmt > 0 && (
              <div className="cp-target-caption">
                {calc.commission >= targetAmt ? (
                  <><b className="pos">Target hit.</b> Projected commission {A$(calc.commission)} is <b className="pos">{A$(calc.commission - targetAmt)}</b> above your {A$(targetAmt)} target.</>
                ) : targetReachable ? (
                  <>Target <b>{A$(targetAmt)}</b> needs <b>{A$(gpForTarget)}</b> qualifying GP — <b className="pos">{A$(gpToTarget)}</b> more from here, about <b>{targetFcl}</b> more weekly FCL {targetFcl === 1 ? "box" : "boxes"} or <b>{targetRoro}</b> monthly RORO {targetRoro === 1 ? "unit" : "units"}.</>
                ) : (
                  <>Target <b>{A$(targetAmt)}</b> can't be reached at a 0% rate — set a commission rate or an accelerator band.</>
                )}
              </div>
            )}
            {(calc.weightedGP < calc.totalGP - 0.5 || calc.excludedCount > 0) && (
              <div className="cp-target-caption">
                Confidence-weighted (expected) GP is <b>{A$(calc.weightedGP)}</b> vs <b>{A$(calc.totalGP)}</b> committed.
                {calc.excludedCount > 0 && <> {calc.excludedCount} account{calc.excludedCount === 1 ? "" : "s"} excluded from totals.</>}
              </div>
            )}
          </section>

          <div className="cp-grid">
            <section className="cp-accounts">
              <div className="cp-section-head">
                <h2>Accounts <span className="cp-count">{q ? `${visibleAccounts.length}/${accounts.length}` : accounts.length}</span></h2>
                <div className="cp-acc-tools">
                  <div className="cp-search">
                    <input aria-label="Search accounts, or type a new name and press Enter to add"
                      placeholder="Search… (Enter to add)" value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); quickAdd(); } }} />
                    {query && <button className="cp-search-clear" aria-label="Clear search" onClick={() => setQuery("")}>×</button>}
                  </div>
                  {accounts.length > 1 && (
                    <select className="cp-sort" aria-label="Sort accounts" value={sort} onChange={(e) => setSort(e.target.value)}>
                      <option value="custom">Custom order</option>
                      <option value="gp-desc">GP: high → low</option>
                      <option value="gp-asc">GP: low → high</option>
                      <option value="name-asc">Name: A → Z</option>
                      <option value="name-desc">Name: Z → A</option>
                    </select>
                  )}
                  {accounts.length > 1 && (
                    <button className="cp-mini" onClick={() => setAllCollapsed(!allCollapsed)}>{allCollapsed ? "Expand all" : "Collapse all"}</button>
                  )}
                  <button className="cp-add" onClick={() => addAccount()}>+ Add account</button>
                </div>
              </div>
              {accounts.length === 0 && (
                <div className="cp-empty">No accounts yet. Add your first win to start projecting.<button className="cp-add big" onClick={() => addAccount()}>+ Add account</button></div>
              )}
              {accounts.length > 0 && visibleAccounts.length === 0 && (
                <div className="cp-empty">No accounts match “{query}”. Press Enter to add it as a new account.</div>
              )}
              {displayAccounts.map((acc) => {
                const isCollapsed = collapsed.has(acc.id);
                const excluded = acc.included === false;
                const conf = acc.confidence == null ? 100 : acc.confidence;
                const realIdx = accounts.findIndex((x) => x.id === acc.id);
                return (
                <div className={"cp-card" + (excluded ? " excluded" : "") + (isCollapsed ? " collapsed" : "")} key={acc.id}>
                  <div className="cp-card-top">
                    <button className="cp-collapse" aria-label={isCollapsed ? "Expand account" : "Collapse account"} aria-expanded={!isCollapsed} onClick={() => toggleCollapse(acc.id)}>{isCollapsed ? "▸" : "▾"}</button>
                    <input className="cp-acc-name" aria-label="Account name" value={acc.name} onChange={(e) => renameAccount(acc.id, e.target.value)} />
                    <div className="cp-acc-total">
                      {A$(calc.accTotals[acc.id])}<span>/yr</span>
                      {conf < 100 && !excluded && <i className="cp-wtag" title="Confidence-weighted">≈ {A$((calc.accTotals[acc.id] || 0) * conf / 100)}</i>}
                    </div>
                    <div className="cp-card-actions">
                      <button className="cp-iconbtn" aria-label="Move account up" title={sorted ? "Switch to Custom order to reorder" : "Move up"} disabled={!!q || sorted || realIdx === 0} onClick={() => moveAccount(acc.id, -1)}>↑</button>
                      <button className="cp-iconbtn" aria-label="Move account down" title={sorted ? "Switch to Custom order to reorder" : "Move down"} disabled={!!q || sorted || realIdx === accounts.length - 1} onClick={() => moveAccount(acc.id, 1)}>↓</button>
                      <button className="cp-iconbtn" aria-label="Duplicate account" title="Duplicate" onClick={() => duplicateAccount(acc.id)}>⧉</button>
                      <button className="cp-x" aria-label="Remove account" title="Remove account" onClick={() => removeAccount(acc.id)}>×</button>
                    </div>
                  </div>
                  <div className="cp-card-meta">
                    <label className="cp-toggle">
                      <input type="checkbox" checked={!excluded} onChange={() => toggleIncluded(acc.id)} />
                      <span>{excluded ? "Excluded — what-if only" : "Included in totals"}</span>
                    </label>
                    <div className="cp-conf" role="group" aria-label="Account confidence percent">
                      <span>Confidence</span>
                      <input type="range" min="0" max="100" step="5" value={conf} aria-label="Confidence slider" onChange={(e) => setConfidence(acc.id, e.target.value)} />
                      <input className="cp-conf-num" type="number" min="0" max="100" value={conf} aria-label="Confidence percent" onChange={(e) => setConfidence(acc.id, e.target.value)} />
                      <em>%</em>
                    </div>
                  </div>
                  {!isCollapsed && (<>
                  <div className="cp-lines">
                    {acc.lines.map((ln) => {
                      const ann = (Number(ln.profit) || 0) * (FREQ_MULT[ln.freq] || 0);
                      return (
                        <div className="cp-line" key={ln.id}>
                          <span className="cp-dot" style={{ background: TYPE_COLOR[ln.type] }} />
                          <select className="cp-sel type" aria-label="Freight type" value={ln.type} onChange={(e) => updateLine(acc.id, ln.id, { type: e.target.value })}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
                          <select className="cp-sel" aria-label="Shipment frequency" value={ln.freq} onChange={(e) => updateLine(acc.id, ln.id, { freq: e.target.value })}>{FREQS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select>
                          <div className="cp-money-in"><span>{CUR.sym}</span><input type="number" aria-label="Profit per shipment" placeholder="0" value={ln.profit ?? ""} onChange={(e) => updateLine(acc.id, ln.id, { profit: e.target.value === "" ? "" : Number(e.target.value) })} onBlur={(e) => { if (e.target.value === "") updateLine(acc.id, ln.id, { profit: 0 }); }} /><em>/shpt</em></div>
                          <div className="cp-line-ann">{A$(ann)}<span>/yr</span>{ln.freq === "one-off" && <i className="cp-tag">one-off</i>}</div>
                          <button className="cp-x sm" aria-label="Remove freight line" onClick={() => removeLine(acc.id, ln.id)}>×</button>
                        </div>
                      );
                    })}
                  </div>
                  <button className="cp-add-line" onClick={() => addLine(acc.id)}>+ freight line</button>
                  </>)}
                </div>
                );
              })}
            </section>

            <aside className="cp-rail">
              <div className="cp-panel">
                <h3>Pipeline &amp; risk</h3>
                <div className="cp-wbars">
                  <div className="cp-wbar-row">
                    <span className="cp-wbar-label">Committed</span>
                    <div className="cp-wbar"><div style={{ width: "100%", background: "var(--navy)" }} /></div>
                    <span className="cp-wbar-val">{A$(calc.totalGP)}</span>
                  </div>
                  <div className="cp-wbar-row">
                    <span className="cp-wbar-label">Weighted</span>
                    <div className="cp-wbar"><div style={{ width: (calc.totalGP > 0 ? (calc.weightedGP / calc.totalGP) * 100 : 0) + "%", background: "var(--blue)" }} /></div>
                    <span className="cp-wbar-val">{A$(calc.weightedGP)}</span>
                  </div>
                </div>
                <p className="cp-foot">
                  {calc.concentration.name
                    ? <>Top account <b>{calc.concentration.name}</b> is <b className={calc.concentration.pct >= 35 ? "neg" : ""}>{Math.round(calc.concentration.pct)}%</b> of qualifying GP{calc.concentration.pct >= 35 ? " — high concentration, so your retention assumption matters more." : "."}</>
                    : "Add accounts to see concentration risk."}
                  {calc.excludedCount > 0 && <> {calc.excludedCount} account{calc.excludedCount === 1 ? "" : "s"} excluded.</>}
                </p>
              </div>
              <div className="cp-panel">
                <h3>Freight mix</h3>
                <div className="cp-mix">
                  {TYPES.map((t) => {
                    const v = calc.byType[t] || 0;
                    const p = calc.totalGP > 0 ? (v / calc.totalGP) * 100 : 0;
                    return (
                      <div className="cp-mix-row" key={t}>
                        <span className="cp-mix-label">{t}</span>
                        <div className="cp-mix-bar"><div style={{ width: p + "%", background: TYPE_COLOR[t] }} /></div>
                        <span className="cp-mix-val">{A$(v)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="cp-panel">
                <h3>Quarterly payout</h3>
                <div className="cp-yearbar" title={`${Math.round(fy.frac * 100)}% through ${fy.label}`}>
                  <div className="cp-yearbar-fill" style={{ width: (fy.frac * 100) + "%" }} />
                  <span className="cp-yearbar-label">{fy.label} · {Math.round(fy.frac * 100)}% elapsed</span>
                </div>
                <table className="cp-qtable">
                  <thead><tr><th>Qtr</th><th>Cumulative GP</th><th>Payment</th></tr></thead>
                  <tbody>
                    {calc.quarters.map((q) => (
                      <tr key={q.q} className={(q.payment > 0 ? "live" : "") + (q.q === fy.quarter ? " now" : "")}>
                        <td>Q{q.q}{q.q === fy.quarter && <i className="cp-now">now</i>}</td><td>{A$(q.cumGP)}</td>
                        <td className={q.payment > 0 ? "pos" : "muted"}>{q.payment > 0 ? A$2(q.payment) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="cp-foot">YTD ({fy.label}, to Q{fy.quarter}): <b>{A$(calc.totalGP * (fy.quarter / 4))}</b> cumulative GP · <b className="pos">{A$2(tierCommission(calc.totalGP * (fy.quarter / 4), calc.threshold, settings.rate, settings.tiers))}</b> paid. Assumes even GP across the year; each payment lands ~6 weeks after the quarter closes.</p>
              </div>
            </aside>
          </div>
        </div>
      )}

      {/* ════════════ ACTUALS & PACE ════════════ */}
      {tab === "actuals" && (
        <div className="cp-tabpanel" role="tabpanel" id="cp-panel-actuals" aria-labelledby="cp-tab-actuals" tabIndex={-1}>
          {/* year switcher */}
          <div className="cp-yearsbar">
            <div className="cp-years">
              {yearKeys.map((y) => (
                <button key={y} className={y === activeYear ? "on" : ""} onClick={() => setActYear(y)}>
                  {fyLabelFor(y, settings.fiscalYearStart)}{y === curYearKey && <span className="cp-years-now">now</span>}
                </button>
              ))}
            </div>
            <button className="cp-btn" onClick={addNextYear}>+ Add year</button>
          </div>

          {/* KPI strip for the active year */}
          <section className="cp-stats">
            <Stat label={isCurrentYear ? "YTD actual GP" : "Actual GP"} value={A$(yearData.ytd)} sub={yearData.enteredQ + " of 4 quarters"} />
            <Stat label="Forecast (frozen)" value={A$(yearData.forecastTotal)} sub={"snapshot · " + A$(yearData.threshold) + " threshold"} />
            <Stat label={yearData.pace >= 0 ? "Ahead of plan" : "Behind plan"} value={A$(Math.abs(yearData.pace))} accent sub={"vs " + A$(yearData.planToDate) + " plan to date"} />
            <Stat label="Commission earned" value={A$(yearData.commission)} sub={isCurrentYear ? "≈ " + A$(yearData.projRunComm) + " at run-rate" : "realised"} />
          </section>

          {/* B4 — quarter-by-quarter pace vs plan */}
          {yearData.enteredQ > 0 && (() => {
            const planQ = yearData.forecastTotal / 4;
            // 18% headroom so the tallest bar's value label fits inside the box.
            // Bars and the plan line share this single reference, so a bar that
            // equals the plan reaches exactly the plan line.
            const max = Math.max(...yearData.qTotals, planQ, 1) * 1.18;
            const planPct = (planQ / max) * 100;
            return (
              <section className="cp-panel solo cp-spark-wrap">
                <div className="cp-spark-head">
                  <h2>Quarter-by-quarter vs plan</h2>
                  <span className="cp-foot" style={{ margin: 0 }}>Plan line {A$(planQ)}/qtr</span>
                </div>
                <div className="cp-spark">
                  <div className="cp-spark-cols">
                    <div className="cp-spark-plan" style={{ bottom: `${planPct}%` }} aria-hidden="true" />
                    {yearData.qTotals.map((v, i) => {
                      const entered = yearData.enteredByQ[i];
                      const cur = isCurrentYear && i + 1 === curQ;
                      const h = (v / max) * 100;
                      const ahead = entered && v >= planQ;
                      return (
                        <div key={i} className={"cp-spark-col" + (cur ? " cur" : "")}>
                          {entered && <span className="cp-spark-val" style={{ bottom: `${Math.max(h, 1.5)}%` }}>{A$(v)}</span>}
                          <div
                            className={"cp-spark-bar" + (!entered ? " empty" : ahead ? " ahead" : " behind")}
                            style={{ height: entered ? `${Math.max(h, 1.5)}%` : "0%" }}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="cp-spark-labels">
                    {[0, 1, 2, 3].map((i) => (
                      <span key={i} className={"cp-spark-lbl" + (isCurrentYear && i + 1 === curQ ? " cur" : "")}>Q{i + 1}</span>
                    ))}
                  </div>
                </div>
              </section>
            );
          })()}

          {snapshotDrift && (
            <div className="cp-nudge">
              <span>Your live forecast ({A$(liveForecastTotal)}) differs from this year's frozen snapshot ({A$(yearData.forecastTotal)}). Re-snapshot to baseline {fyLabelFor(activeYear, settings.fiscalYearStart)} on your current figures?</span>
              <button className="cp-btn" onClick={() => reSnapshot(activeYear)}>Re-snapshot now</button>
            </div>
          )}

          {/* frozen pay snapshot for this year */}
          <div className="cp-snap">
            <div className="cp-snap-head">
              <div>
                <span className="cp-eyebrow" style={{ marginBottom: 0 }}>Pay snapshot · {fyLabelFor(activeYear, settings.fiscalYearStart)}</span>
                {snapshotAt && <span className="cp-snap-date">Forecast frozen {new Date(snapshotAt).toLocaleDateString(CUR.locale, { day: "numeric", month: "short", year: "numeric" })}</span>}
              </div>
              <div className="cp-snap-actions">
                <button className="cp-btn" onClick={() => reSnapshot(activeYear)}>Re-snapshot from live</button>
                <button className="cp-btn danger" onClick={() => deleteYear(activeYear)}>Delete year</button>
              </div>
            </div>
            <div className="cp-snap-grid">
              <Field label="Base salary"><Money value={yearData.comp ? yearData.comp.base : 0} onChange={(v) => setYearComp(activeYear, { base: v })} /></Field>
              <Field label="Car allowance"><Money value={yearData.comp ? yearData.comp.car : 0} onChange={(v) => setYearComp(activeYear, { car: v })} /></Field>
              <Field label="Threshold multiplier"><div className="cp-money-in wide"><span>×</span><input type="number" step="0.1" placeholder="0" value={yearData.comp ? (yearData.comp.multiplier ?? "") : 0} onChange={(e) => setYearComp(activeYear, { multiplier: e.target.value === "" ? "" : Number(e.target.value) })} onBlur={(e) => { if (e.target.value === "") setYearComp(activeYear, { multiplier: 0 }); }} /></div></Field>
              <Field label="Commission rate"><div className="cp-money-in wide"><span>%</span><input type="number" step="0.5" placeholder="0" value={yearData.comp ? (yearData.comp.rate ?? "") : 0} onChange={(e) => setYearComp(activeYear, { rate: e.target.value === "" ? "" : Number(e.target.value) })} onBlur={(e) => { if (e.target.value === "") setYearComp(activeYear, { rate: 0 }); }} /></div></Field>
            </div>
            <p className="cp-foot">Frozen at year start so history doesn't drift when you change live settings. Package {A$(yearData.pkg)} × {yearData.comp ? yearData.comp.multiplier : 0} = {A$(yearData.threshold)} threshold; commission is {yearData.comp ? yearData.comp.rate : 0}% over.</p>
          </div>

          {/* per-account quarterly ledger */}
          <div className="cp-ledger-wrap">
            <div className="cp-ledger-top">
              <h2>Actual GP by account &amp; quarter</h2>
              <span className="cp-foot" style={{ margin: 0 }}>{isCurrentYear ? `Current quarter: Q${curQ}` : "Closed year"}</span>
            </div>
            <div className="cp-ledger-scroll">
              <table className="cp-ledger">
                <thead>
                  <tr>
                    <th className="acc">Account</th>
                    <th className="num">Forecast</th>
                    {[1, 2, 3, 4].map((q) => (
                      <th key={q} className={"num q" + (isCurrentYear && q === curQ ? " cur" : "")}>
                        Q{q}<span className="span">{qSpans[q - 1]}</span>
                      </th>
                    ))}
                    <th className="num">Year actual</th>
                    <th className="num">Δ vs fc</th>
                  </tr>
                </thead>
                <tbody>
                  {yearData.perAcc.length === 0 && (
                    <tr><td className="acc empty" colSpan={8}>No accounts yet — add accounts on the Accounts tab, or enter figures below once you have them.</td></tr>
                  )}
                  {yearData.perAcc.map((r) => (
                    <tr key={r.id} className={r.orphan ? "orphan" : ""}>
                      <td className="acc">
                        <span className="nm">{r.name}</span>
                        {r.orphan && <span className="tag">removed</span>}
                      </td>
                      <td className="num fc">{r.forecast ? A$(r.forecast) : "—"}</td>
                      {[0, 1, 2, 3].map((i) => {
                        const future = isCurrentYear && i + 1 > curQ;
                        const cur = isCurrentYear && i + 1 === curQ;
                        return (
                          <td key={i} className={"cell" + (cur ? " cur" : "") + (future ? " future" : "")}>
                            <input type="number" value={r.qv[i] == null ? "" : r.qv[i]} placeholder={future ? "" : "0"}
                              aria-label={r.name + " — Q" + (i + 1) + " actual GP"}
                              onChange={(e) => setCell(activeYear, r.id, QKEYS[i], e.target.value)} />
                          </td>
                        );
                      })}
                      <td className="num total">{r.hasAny ? A$(r.sum) : "—"}</td>
                      <td className={"num delta " + (!r.hasAny ? "muted" : r.variance >= 0 ? "pos" : "neg")}>
                        {r.hasAny ? (r.variance >= 0 ? "+" : "−") + A$(Math.abs(r.variance)) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="acc">Total</td>
                    <td className="num">{A$(yearData.forecastTotal)}</td>
                    {[0, 1, 2, 3].map((i) => (
                      <td key={i} className={"num" + (isCurrentYear && i + 1 === curQ ? " cur" : "")}>{A$(yearData.qTotals[i])}</td>
                    ))}
                    <td className="num total">{A$(yearData.ytd)}</td>
                    <td className={"num delta " + (yearData.ytd - yearData.forecastTotal >= 0 ? "pos" : "neg")}>
                      {(yearData.ytd - yearData.forecastTotal >= 0 ? "+" : "−") + A$(Math.abs(yearData.ytd - yearData.forecastTotal))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="cp-foot">Enter realised qualifying GP per account as each quarter closes. Δ compares the year's actual against the forecast frozen at year start. Removed accounts stay visible in the years they have history.</p>
          </div>

          {/* cross-year history */}
          {history.rows.length > 0 && (
            <div className="cp-panel solo">
              <div className="cp-panel-head">
                <h3>Year history</h3>
                <button className="cp-btn" onClick={exportActualsCSV}>Export history (CSV)</button>
              </div>
              <table className="cp-ptable">
                <thead><tr><th>Year</th><th>Actual GP</th><th>Threshold</th><th>Commission</th><th>Cumulative</th><th>Retention</th></tr></thead>
                <tbody>
                  {history.rows.map((r) => (
                    <tr key={r.y} className={r.y === activeYear ? "live" : ""}>
                      <td>{fyLabelFor(r.y, settings.fiscalYearStart)}</td>
                      <td>{A$(r.actual)}</td>
                      <td>{A$(r.threshold)}</td>
                      <td>{A$(r.commission)}</td>
                      <td>{A$(r.cum)}</td>
                      <td className={r.retention == null ? "muted" : r.retention >= 100 ? "pos" : ""}>{r.retention == null ? "—" : Math.round(r.retention) + "%"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td>Total</td><td colSpan={2}></td><td>{A$(history.cumCommission)}</td><td colSpan={2}></td></tr></tfoot>
              </table>
              <p className="cp-foot">Retention = this year's actual GP as a share of last year's — a quick read on how much business carried forward. Cumulative tallies commission earned across all tracked years.</p>
            </div>
          )}
        </div>
      )}

      {/* ════════════ TAB 2 ════════════ */}
      {tab === "multi" && (
        <div className="cp-tabpanel" role="tabpanel" id="cp-panel-multi" aria-labelledby="cp-tab-multi" tabIndex={-1}>
          <section className="cp-proj-controls">
            <div className="cp-sliders">
              <div className="cp-ret">
                <div className="cp-ret-head">
                  <span className="cp-ret-label">Account retention</span>
                  <span className="cp-ret-val">{proj.retention}%</span>
                </div>
                <input className="cp-range" type="range" min="0" max="100" step="1" value={proj.retention} onChange={(e) => setProj((p) => ({ ...p, retention: Number(e.target.value) }))} />
                <div className="cp-chips">
                  {[70, 80, 90, 100].map((v) => (
                    <button key={v} className={proj.retention === v ? "on" : ""} onClick={() => setProj((p) => ({ ...p, retention: v }))}>{v}%</button>
                  ))}
                </div>
                <p className="cp-ret-note">Share of each year's book that rolls into the next. Year 1 is your current book ({A$(calc.totalGP)}). It compounds, so a low rate shrinks the carried book fast — at 70% it's ~12% of year 1 by year 7.</p>
              </div>

              <div className="cp-ret">
                <div className="cp-ret-head">
                  <span className="cp-ret-label">New-business growth</span>
                  <span className="cp-ret-val">{proj.newGrowth}%</span>
                </div>
                <input className="cp-range" type="range" min="0" max="200" step="5" value={proj.newGrowth} onChange={(e) => setProj((p) => ({ ...p, newGrowth: Number(e.target.value) }))} />
                <div className="cp-chips">
                  {[0, 85, 100, 150].map((v) => (
                    <button key={v} className={proj.newGrowth === v ? "on" : ""} onClick={() => setProj((p) => ({ ...p, newGrowth: v }))}>{v}%</button>
                  ))}
                </div>
                <p className="cp-ret-note">Year-on-year change in new GP won. Over 100% ramps up; under 100% slows as the book fills; 0% means no new wins.</p>
              </div>
            </div>

            <div className="cp-proj-fields">
              <Field label="New GP won per year">
                <div className="cp-money-in wide">
                  <span>{CUR.sym}</span>
                  <input type="number" value={proj.newPerYear == null ? "" : proj.newPerYear} placeholder={String(Math.round(calc.totalGP))} onChange={(e) => setProj((p) => ({ ...p, newPerYear: e.target.value === "" ? null : Number(e.target.value) }))} />
                </div>
                <button className="cp-mini" onClick={() => setProj((p) => ({ ...p, newPerYear: null }))}>↺ match current</button>
              </Field>
              <Field label="Annual pay rise (package)"><Money value={proj.payRise} onChange={(v) => setProj((p) => ({ ...p, payRise: v }))} /></Field>
              <Field label="Years to project">
                <select className="cp-input" value={proj.years} onChange={(e) => setProj((p) => ({ ...p, years: Number(e.target.value) }))}>
                  {[3, 4, 5, 6, 7].map((y) => <option key={y} value={y}>{y} years</option>)}
                </select>
              </Field>
              <Field label="Discount rate % (NPV)">
                <div className="cp-money-in wide"><span>%</span><input type="number" step="0.5" min="0" placeholder="0" value={proj.discount ?? ""} onChange={(e) => setProj((p) => ({ ...p, discount: e.target.value === "" ? "" : Number(e.target.value) }))} onBlur={(e) => { if (e.target.value === "") setProj((p) => ({ ...p, discount: 0 })); }} /></div>
              </Field>
            </div>
          </section>

          <section className="cp-stats three">
            <Stat label={`Year ${proj.years} GP`} value={A$(lastRow.total)} sub="rolled-up book" />
            <Stat label={`Year ${proj.years} commission`} value={A$(lastRow.commission)} />
            <Stat label={`${proj.years}-year commission`} value={A$(projection.cumComm)} accent sub={projection.disc > 0 ? `${A$(projection.npvComm)} present value` : "cumulative"} />
          </section>

          <section className="cp-chart-wrap">
            <div className="cp-chart">
              {projection.rows.map((r) => {
                const carriedH = (r.carried / projection.max) * 100;
                const newH = (r.newGP / projection.max) * 100;
                const thrH = (r.threshold / projection.max) * 100;
                return (
                  <div className="cp-col" key={r.y}>
                    <div className="cp-comm">{r.commission > 0 ? A$(r.commission) : ""}</div>
                    <div className="cp-bar">
                      <div className="cp-bar-thr" style={{ bottom: thrH + "%" }}><i>{A$(r.threshold)}</i></div>
                      <div className="cp-bar-new" style={{ height: newH + "%" }} title={"New " + A$(r.newGP)} />
                      <div className="cp-bar-carried" style={{ height: carriedH + "%" }} title={"Carried " + A$(r.carried)} />
                    </div>
                    <div className="cp-col-foot"><b>Y{r.y}</b><span>{A$(r.total)}</span></div>
                  </div>
                );
              })}
            </div>
            <div className="cp-legend">
              <span><i style={{ background: "#1C3857" }} /> Carried (retained)</span>
              <span><i style={{ background: "#009BD6" }} /> New business</span>
              <span><i className="line" /> Threshold</span>
              <span><i style={{ background: "#72C481" }} /> Commission (above bar)</span>
            </div>
          </section>

          <section className="cp-panel solo">
            <div className="cp-panel-head">
              <h3>Year-by-year</h3>
              <button className="cp-mini" onClick={exportCSV}>↓ Export CSV</button>
            </div>
            <div className="cp-ptable-wrap">
              <table className="cp-ptable">
                <thead><tr><th>Year</th><th>Package</th><th>Threshold</th><th>Carried</th><th>New</th><th>Total GP</th><th>Commission</th><th>Earnings</th></tr></thead>
                <tbody>
                  {projection.rows.map((r) => (
                    <tr key={r.y}>
                      <td><b>Y{r.y}</b></td>
                      <td>{A$(r.pkg)}</td>
                      <td>{A$(r.threshold)}</td>
                      <td className="muted">{r.carried > 0 ? A$(r.carried) : "—"}</td>
                      <td>{A$(r.newGP)}</td>
                      <td><b>{A$(r.total)}</b></td>
                      <td className="pos">{A$(r.commission)}</td>
                      <td>{A$(r.earnings)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="cp-foot">Year 1 = your current book{calc.oneOffGP > 0 ? ` (including ${A$(calc.oneOffGP)} of one-off wins)` : ""}. Each later year carries the prior {calc.oneOffGP > 0 ? "recurring " : ""}book forward at {proj.retention}% retention{calc.oneOffGP > 0 ? " — one-off wins don't repeat" : ""} and adds new GP{proj.newGrowth === 100 ? ` of ${A$(projection.newPY)}` : ` based on ${A$(projection.newPY)}, compounding ${proj.newGrowth}% a year from year 2`}. Threshold grows with any pay rise. Commission is {tiers.length ? `tiered, starting at ${settings.rate}%` : `${settings.rate}%`} on every dollar over that year's threshold. The {proj.years}-year total sums each year's commission in nominal dollars{projection.disc > 0 ? `; the present value discounts later years at ${proj.discount}% a year back to today` : " (no inflation discount)"}.</p>
          </section>
        </div>
      )}

      {/* ════════════ SCENARIOS ════════════ */}
      {tab === "scenarios" && (
        <div className="cp-tabpanel" role="tabpanel" id="cp-panel-scenarios" aria-labelledby="cp-tab-scenarios" tabIndex={-1}>
          <section className="cp-proj-controls solo-head">
            <div className="cp-section-head wide">
              <div>
                <h2>Scenarios</h2>
                <p className="cp-foot" style={{ margin: "2px 0 0" }}>Save the current accounts, settings &amp; forecast as a named snapshot, then compare side by side.</p>
              </div>
              <button className="cp-add" onClick={saveScenario}>+ Save current</button>
            </div>
          </section>

          <section className="cp-panel solo">
            <div className="cp-ptable-wrap">
              <table className="cp-ptable">
                <thead>
                  <tr>
                    <th>Scenario</th><th>Qualifying GP</th><th>Threshold</th><th>Commission</th><th>Total earnings</th><th>{proj.years}-yr commission</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const liveProj = projection;
                    return (
                      <tr className="cp-live-row">
                        <td><b>Current (live)</b></td>
                        <td>{A$(calc.totalGP)}</td>
                        <td>{A$(calc.threshold)}</td>
                        <td className="pos">{A$(calc.commission)}</td>
                        <td>{A$(calc.total)}</td>
                        <td><b>{A$(liveProj.cumComm)}</b></td>
                        <td className="cp-row-actions" />
                      </tr>
                    );
                  })()}
                  {scenarios.length === 0 && (
                    <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: "18px" }}>No saved scenarios yet — tweak your figures, then “Save current”.</td></tr>
                  )}
                  {scenarios.map((sc) => {
                    const sCalc = computeCalc(sc.data.accounts || [], { ...DEFAULT_SETTINGS, ...(sc.data.settings || {}) });
                    const sProj = computeProjection(sCalc, { ...DEFAULT_SETTINGS, ...(sc.data.settings || {}) }, { ...DEFAULT_PROJ, ...(sc.data.proj || {}) });
                    return (
                      <tr key={sc.id}>
                        <td><b>{sc.name}</b></td>
                        <td>{A$(sCalc.totalGP)}</td>
                        <td>{A$(sCalc.threshold)}</td>
                        <td className="pos">{A$(sCalc.commission)}</td>
                        <td>{A$(sCalc.total)}</td>
                        <td><b>{A$(sProj.cumComm)}</b></td>
                        <td className="cp-row-actions">
                          <button className="cp-mini" onClick={() => loadScenario(sc)}>Load</button>
                          <button className="cp-mini danger" onClick={() => deleteScenario(sc.id)}>Delete</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="cp-foot">“Load” replaces your current working figures with the snapshot (your live figures aren’t saved automatically — save them first if you want to keep them). Multi-year commission uses each scenario’s own retention &amp; new-business assumptions.</p>
          </section>

          {scenarios.length > 0 && (() => {
            const bars = [
              { id: "__live", name: "Current (live)", value: projection.cumComm, live: true },
              ...scenarios.map((sc) => {
                const sCalc = computeCalc(sc.data.accounts || [], { ...DEFAULT_SETTINGS, ...(sc.data.settings || {}) });
                const sProj = computeProjection(sCalc, { ...DEFAULT_SETTINGS, ...(sc.data.settings || {}) }, { ...DEFAULT_PROJ, ...(sc.data.proj || {}) });
                return { id: sc.id, name: sc.name, value: sProj.cumComm, live: false };
              }),
            ];
            const max = Math.max(...bars.map((b) => b.value), 1);
            const best = bars.reduce((m, b) => (b.value > m.value ? b : m), bars[0]);
            return (
              <section className="cp-panel solo">
                <h2 className="cp-cmp-title">{proj.years}-year commission by scenario</h2>
                <div className="cp-cmp-chart">
                  {bars.map((b) => (
                    <div className={"cp-cmp-row" + (b.live ? " live" : "")} key={b.id}>
                      <span className="cp-cmp-name" title={b.name}>{b.name}</span>
                      <span className="cp-cmp-bar-track">
                        <span className="cp-cmp-bar" style={{ width: (Math.max(0, b.value) / max) * 100 + "%" }} />
                      </span>
                      <span className="cp-cmp-val">{A$(b.value)}</span>
                    </div>
                  ))}
                </div>
                <p className="cp-foot">Highest {proj.years}-year commission: <b>{best.name}</b> at <b className="pos">{A$(best.value)}</b>. Bars compare cumulative commission across the same horizon using each scenario’s own assumptions.</p>
              </section>
            );
          })()}
        </div>
      )}

      <footer className="cp-footer">
        <img className="ft-foot-img" src={ICON_SRC} alt="Freight Tasker" />
        <span>Connecting ideas, people, goods and opportunity</span>
      </footer>

      {dialog && (
        <div className="cp-modal-backdrop" onClick={() => closeDialog(dialog.input ? null : false)}>
          <div className="cp-modal" role="dialog" aria-modal="true" aria-labelledby="cp-modal-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") { closeDialog(dialog.input ? null : false); return; }
              // Trap Tab focus inside the dialog so keyboard users can't tab out
              // to the (inert) page behind it.
              if (e.key === "Tab") {
                const f = e.currentTarget.querySelectorAll('button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])');
                if (!f.length) return;
                const first = f[0], last = f[f.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
              }
            }}>
            <h2 id="cp-modal-title" className="cp-modal-title">{dialog.title}</h2>
            {dialog.body && <p className="cp-modal-body">{dialog.body}</p>}
            {dialog.input && (
              <input className="cp-input cp-modal-input" ref={modalInputRef} autoFocus
                defaultValue={dialog.defaultValue || ""}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); closeDialog(modalInputRef.current?.value ?? ""); } }} />
            )}
            <div className="cp-modal-actions">
              <button className="cp-btn" onClick={() => closeDialog(dialog.input ? null : false)}>{dialog.cancelLabel || "Cancel"}</button>
              <button className={"cp-btn " + (dialog.danger ? "danger" : "primary")} autoFocus={!dialog.input}
                onClick={() => closeDialog(dialog.input ? (modalInputRef.current?.value ?? "") : true)}>{dialog.confirmLabel || "Confirm"}</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={"cp-toast " + (toast.kind || "info")} role="status" aria-live="polite">
          <span className="cp-toast-msg">{toast.message}</span>
          {toast.actionLabel && <button className="cp-toast-action" onClick={runToastAction}>{toast.actionLabel}</button>}
          <button className="cp-toast-close" aria-label="Dismiss" onClick={dismissToast}>×</button>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── small pieces ───────────────────────── */
function Stat({ label, value, sub, accent }) {
  return (
    <div className={"cp-stat" + (accent ? " accent" : "")}>
      <div className="cp-stat-label">{label}</div>
      <div className="cp-stat-value">{value}</div>
      {sub && <div className="cp-stat-sub">{sub}</div>}
    </div>
  );
}
function Field({ label, children }) {
  return (<label className="cp-field"><span>{label}</span>{children}</label>);
}
function Money({ value, onChange }) {
  // Pass the empty string through while the field is being cleared so the input
  // doesn't snap to 0 mid-edit; the engine coerces with Number(x) || 0 downstream.
  // On blur, settle a left-empty field back to 0 so stored state stays numeric.
  return (<div className="cp-money-in wide"><span>{CUR.sym}</span><input type="number" placeholder="0" value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} onBlur={(e) => { if (e.target.value === "") onChange(0); }} /></div>);
}
function Track({ threshold, total }) {
  const scaleMax = Math.max(total, threshold) * 1.08 || 1;
  const thrPct = (threshold / scaleMax) * 100;
  const navyPct = (Math.min(total, threshold) / scaleMax) * 100;
  const grnPct = (Math.max(0, total - threshold) / scaleMax) * 100;
  const todayPct = Math.min(100, (total / scaleMax) * 100); // fill edge = your booked GP
  return (
    <div className="cp-track">
      <div className="cp-track-bar">
        <div className="cp-fill navy" style={{ width: navyPct + "%" }} />
        <div className="cp-fill grn" style={{ left: thrPct + "%", width: grnPct + "%" }} />
        <div className="cp-today" style={{ left: todayPct + "%" }}><span className="cp-today-flag">▲ today</span></div>
        <div className="cp-thr" style={{ left: thrPct + "%" }}><span className="cp-thr-flag">⚑ {A$(threshold)}</span></div>
      </div>
      <div className="cp-track-scale"><span>{A$(0)}</span><span className="right">{A$(scaleMax)}</span></div>
    </div>
  );
}

/* ───────────────────────── styles ───────────────────────── */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Jost:wght@300;400;500;600;700;800&display=swap');
body{background:#fafbfc;}
.cp-root{
  --navy:#1c3857; --navy-d:#13283f; --blue:#009bd6; --blue-d:#0480b0;
  --grn:#72c481; --grn-d:#479a5c;
  --field:#fafbfc; --backdrop:#eaeef2;
  --hairline:#d8e0e8; --hairline-faint:#eef2f6; --group-tint:#f1f5f9;
  --ink:#1c3857; --label:#5c6e80; --text-2:#556778; --muted:#5c6e80;
  --dash:#6f7c8a; --saved-text:#3f7e50;
  --on-navy-track:#2f4c6e; --on-navy-label:#7fa8c9; --on-navy-muted:#9fbdd6;
  --amber:#d98a2b; --amber-text:#a8651a; --amber-bg:#fcf2e4;
  --danger:#c0492f;
  --line:#d8e0e8; --card:#ffffff;
  --rf:3px; --rc:2px;
  --fh:'Jost',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  --fb:'Jost',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  font-family:var(--fb); background:var(--field); color:var(--ink);
  width:95%; max-width:1440px; margin:0 auto; padding:54px 0 70px;
  font-variant-numeric:tabular-nums; -webkit-font-smoothing:antialiased;
}
.cp-root *{box-sizing:border-box;}
/* Visible keyboard focus ring on all interactive controls (mouse clicks are
   unaffected — :focus-visible only matches keyboard/programmatic focus). */
.cp-root button:focus-visible,.cp-root a:focus-visible,.cp-root select:focus-visible{outline:2px solid var(--blue);outline-offset:2px;border-radius:2px;}
.cp-tabpanel:focus{outline:none;}
.cp-root .ftnum,.cp-root [class*="-val"],.cp-root [class*="-total"]{font-variant-numeric:tabular-nums;}

/* ── logo ── */
.ft-logo{display:flex;align-items:center;gap:11px;}
.ft-word{font-family:var(--fh);font-weight:700;font-size:25px;color:var(--navy);letter-spacing:-.01em;}
.ft-mark{display:block;}
.ft-logo-img{display:block;height:34px;width:34px;}
.ft-foot-img{display:block;height:18px;width:18px;opacity:.55;}

/* ── header ── */
.cp-header{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;padding-bottom:22px;border-bottom:1px solid var(--navy);}
.cp-head-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;}
.cp-save{display:flex;align-items:center;gap:7px;font-family:var(--fb);font-size:13px;font-weight:600;color:var(--saved-text);}
.cp-save-dot{width:8px;height:8px;border-radius:50%;background:var(--grn);flex:none;}
.cp-save.warn{color:var(--amber-text);} .cp-save.warn .cp-save-dot{background:var(--amber);}
.cp-save.off{color:var(--text-2);} .cp-save.off .cp-save-dot{background:var(--text-2);}
.cp-save.err{color:var(--danger);} .cp-save.err .cp-save-dot{background:var(--danger);}
.cp-btn{font-family:var(--fb);background:#fff;color:var(--navy);border:1px solid var(--navy);border-radius:var(--rc);padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;transition:background .15s ease,color .15s ease;}
.cp-btn:hover{background:var(--group-tint);}
.cp-btn.primary{background:var(--navy);color:#fff;}
.cp-btn.primary:hover{background:var(--navy-d);}

/* ── meta band ── */
.cp-meta{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--navy);border-top:none;background:#fff;margin-bottom:30px;}
.cp-meta-cell{padding:13px 18px;border-right:1px solid var(--hairline);}
.cp-meta-cell:last-child{border-right:none;}
.cp-meta-cell.status{display:flex;align-items:center;}
.cp-meta-label{font-size:10px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--label);margin-bottom:3px;}
.cp-meta-val{font-size:14px;font-weight:600;color:var(--navy);font-variant-numeric:tabular-nums;}
.cp-status{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#fff;background:var(--navy);padding:5px 11px;border-radius:var(--rc);}
.cp-status.above{background:var(--grn);color:var(--navy);}

/* ── title + tabs ── */
.cp-eyebrow{font-family:var(--fb);font-size:12px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--blue);margin-bottom:7px;}
.cp-titlerow{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:26px;}
.cp-title{font-family:var(--fh);font-size:44px;font-weight:800;letter-spacing:-.025em;margin:0;color:var(--navy);line-height:1;}
.cp-tabs{display:flex;border:1px solid var(--hairline);border-radius:var(--rc);overflow:hidden;}
.cp-tabs button{font-family:var(--fb);border:0;border-left:1px solid var(--hairline);background:#fff;padding:9px 16px;font-size:13px;font-weight:500;color:var(--text-2);cursor:pointer;transition:background .15s ease,color .15s ease;}
.cp-tabs button:first-child{border-left:none;}
.cp-tabs button.on{background:var(--navy);color:#fff;font-weight:600;}

/* ── settings ── */
.cp-settings{margin-bottom:30px;background:#fff;border:1px solid var(--hairline);border-radius:var(--rf);padding:18px;display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:14px;align-items:end;}
.cp-tiers{grid-column:1/-1;border-top:1px solid var(--hairline-faint);padding-top:14px;}
.cp-tiers-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px;flex-wrap:wrap;}
.cp-tiers-head b{font-size:14px;color:var(--navy);}
.cp-tiers-sub{display:block;font-size:12px;color:var(--text-2);margin-top:2px;}
.cp-tier-row{display:flex;align-items:center;gap:12px;padding:7px 0;border-top:1px solid var(--hairline-faint);font-size:13px;color:var(--text-2);}
.cp-tier-row:first-of-type{border-top:none;}
.cp-tier-base{color:var(--label);font-weight:600;}
.cp-tier-label{flex:1;display:flex;align-items:center;gap:7px;flex-wrap:wrap;}
.cp-tier-label em{color:var(--label);font-style:normal;font-variant-numeric:tabular-nums;}
.cp-tier-mult,.cp-tier-pct{font-family:var(--fb);border:1px solid var(--hairline);border-radius:var(--rc);padding:5px 7px;font-size:13px;font-weight:600;color:var(--navy);background:#fff;width:62px;text-align:right;font-variant-numeric:tabular-nums;}
.cp-tier-mult:focus,.cp-tier-pct:focus{outline:none;border-color:var(--blue);box-shadow:0 0 0 3px rgba(0,155,214,.13);}
.cp-tier-rate{font-weight:700;color:var(--navy);font-variant-numeric:tabular-nums;display:flex;align-items:center;gap:2px;min-width:64px;justify-content:flex-end;}
.cp-tier-x{width:20px;display:flex;justify-content:center;flex-shrink:0;}
.cp-settings-note{grid-column:1/-1;font-size:13px;color:var(--text-2);border-top:1px solid var(--hairline-faint);padding-top:12px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;}
.cp-settings-note b{color:var(--navy);font-weight:700;}
.cp-data-row{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;border-top:1px solid var(--hairline-faint);padding-top:14px;}
.cp-data-text{font-size:13px;color:var(--text-2);line-height:1.5;font-weight:500;max-width:60ch;}
.cp-data-text b{color:var(--navy);font-weight:700;}
.cp-data-actions{display:flex;gap:8px;flex-wrap:wrap;flex:none;}
.cp-reset{font-family:var(--fb);margin-left:auto;background:none;border:1px solid var(--hairline);color:var(--text-2);border-radius:var(--rc);padding:6px 12px;font-size:12px;cursor:pointer;}
.cp-reset:hover{border-color:#c0492f;color:#c0492f;}
.cp-field{display:flex;flex-direction:column;gap:6px;font-family:var(--fb);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--label);}
.cp-input{font-family:var(--fb);border:1px solid var(--hairline);border-radius:var(--rc);padding:10px;font-size:15px;font-weight:600;color:var(--navy);background:#fff;font-variant-numeric:tabular-nums;}

/* ── hero: instrument + readouts ── */
.cp-hero{display:grid;grid-template-columns:1.15fr .85fr;border:1px solid var(--navy);border-radius:var(--rf);overflow:hidden;margin-bottom:22px;}
.cp-instr{background:var(--navy);color:#fff;padding:30px 34px;position:relative;overflow:hidden;border-right:1px solid var(--navy);}
.cp-instr-mark{position:absolute;right:-50px;top:-50px;width:300px;height:300px;filter:brightness(0) invert(1);opacity:.05;pointer-events:none;}
.cp-instr-label{font-size:12px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--on-navy-label);margin-bottom:6px;position:relative;z-index:1;}
.cp-gauge{display:flex;align-items:center;gap:26px;position:relative;z-index:1;}
.cp-gauge svg{display:block;flex-shrink:0;}
.cp-gauge-pct{font-family:var(--fh);font-size:42px;font-weight:800;line-height:1;color:#fff;font-variant-numeric:tabular-nums;}
.cp-gauge-pct span{font-size:22px;font-weight:800;}
.cp-gauge-sub{font-size:12px;color:var(--on-navy-muted);margin-top:6px;font-variant-numeric:tabular-nums;}
.cp-instr-headline{margin-top:14px;display:flex;align-items:center;gap:14px;position:relative;z-index:1;border-top:1px solid var(--on-navy-track);padding-top:16px;flex-wrap:wrap;}
.cp-instr-eyebrow{font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--on-navy-label);margin-bottom:2px;}
.cp-instr-comm{font-family:var(--fh);font-size:46px;font-weight:800;color:var(--grn);line-height:1;font-variant-numeric:tabular-nums;}
.cp-linechip{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--navy);background:var(--on-navy-label);padding:5px 10px;border-radius:var(--rc);}
.cp-linechip.above{background:var(--grn);}
.cp-readouts{display:flex;flex-direction:column;background:#fff;}
.cp-readout{flex:1;display:flex;justify-content:space-between;align-items:center;padding:22px 26px;border-bottom:1px solid var(--hairline);gap:12px;}
.cp-readout:last-child{border-bottom:none;}
.cp-readout-label{font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--label);margin-bottom:5px;}
.cp-readout-sub{font-size:12px;color:var(--label);}
.cp-readout-val{font-family:var(--fh);font-size:34px;font-weight:800;color:var(--navy);font-variant-numeric:tabular-nums;}

/* ── distance heading tape ── */
.cp-track-wrap{border:1px solid var(--hairline);border-radius:var(--rf);background:#fff;padding:22px 26px;margin-bottom:30px;}
.cp-tape-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:26px;gap:12px;flex-wrap:wrap;}
.cp-tape-title{font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--navy);}
.cp-tape-rem{font-family:var(--fh);font-size:15px;font-weight:700;color:var(--navy);font-variant-numeric:tabular-nums;}
.cp-track{margin-bottom:0;}
.cp-track-bar{position:relative;height:10px;background:var(--hairline-faint);margin-bottom:8px;}
.cp-fill{position:absolute;top:0;height:100%;}
.cp-fill.navy{left:0;background:var(--navy);}
.cp-fill.grn{background:var(--grn);}
.cp-today{position:absolute;top:-9px;bottom:-9px;width:1px;background:var(--navy);}
.cp-today-flag{position:absolute;top:-17px;left:50%;transform:translateX(-50%);white-space:nowrap;font-family:var(--fb);font-size:10px;font-weight:700;letter-spacing:.06em;color:var(--navy);}
.cp-thr{position:absolute;top:-9px;bottom:-9px;width:1px;background:var(--blue);}
.cp-thr-flag{position:absolute;top:-17px;left:50%;transform:translateX(-50%);white-space:nowrap;font-family:var(--fb);font-size:10px;font-weight:700;letter-spacing:.06em;color:var(--blue);}
.cp-track-scale{display:flex;justify-content:space-between;font-size:11px;color:var(--label);font-variant-numeric:tabular-nums;}
.cp-track-caption{margin-top:16px;border-top:1px solid var(--hairline-faint);padding-top:14px;font-size:14px;color:#3a4a5c;font-weight:500;}
.cp-track-caption b{color:var(--navy);font-weight:700;} .cp-track-caption .pos,.pos{color:var(--grn-d);}

/* ── KPI strip (shared, other tabs) ── */
.cp-stats{margin-bottom:22px;display:grid;grid-template-columns:repeat(4,1fr);gap:0;border:1px solid var(--hairline);border-radius:var(--rf);overflow:hidden;background:#fff;}
.cp-stats.three{grid-template-columns:repeat(3,1fr);}
.cp-stat{background:#fff;border-right:1px solid var(--hairline);padding:18px 20px;}
.cp-stat:last-child{border-right:none;}
.cp-stat.accent{position:relative;overflow:hidden;background:var(--navy);border-right-color:var(--navy);}
.cp-stat.accent::after{content:"";position:absolute;right:-26px;bottom:-26px;width:118px;height:118px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='46' fill='none' stroke='%23ffffff' stroke-opacity='0.10' stroke-width='3'/%3E%3Cpath fill='%23ffffff' fill-opacity='0.10' fill-rule='evenodd' d='M50 12 L59.2 40.8 L88 50 L59.2 59.2 L50 88 L40.8 59.2 L12 50 L40.8 40.8 Z M43 50 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0 Z'/%3E%3C/svg%3E");background-size:contain;}
.cp-stat-label{font-family:var(--fb);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.14em;color:var(--label);}
.cp-stat.accent .cp-stat-label{color:var(--on-navy-label);}
.cp-stat-value{font-family:var(--fh);font-size:30px;font-weight:800;margin-top:6px;color:var(--navy);font-variant-numeric:tabular-nums;}
.cp-stat.accent .cp-stat-value{color:var(--grn);}
.cp-stat-sub{font-size:12px;color:var(--label);margin-top:3px;font-weight:500;}
.cp-stat.accent .cp-stat-sub{color:var(--on-navy-muted);}

/* ── ledger + rail grid ── */
.cp-grid{display:grid;grid-template-columns:1fr 360px;gap:24px;align-items:start;}
.cp-grid>*{min-width:0;}
.cp-section-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:12px;flex-wrap:wrap;}
.cp-section-head h2{font-family:var(--fh);font-size:13px;font-weight:700;letter-spacing:.14em;color:var(--navy);margin:0;text-transform:uppercase;}
.cp-add{font-family:var(--fb);background:var(--grn);color:#16321f;border:0;border-radius:var(--rc);padding:8px 15px;font-size:12.5px;font-weight:700;cursor:pointer;transition:filter .15s ease;}
.cp-add:hover{filter:brightness(.95);}
.cp-add.big{display:block;margin:12px auto 0;}

/* ── account ledger card ── */
.cp-card{background:#fff;border:1px solid var(--hairline);border-radius:var(--rf);overflow:hidden;margin-bottom:14px;}
.cp-card-top{display:flex;align-items:center;gap:10px;padding:12px 20px;background:var(--group-tint);border-bottom:1px solid var(--hairline);}
.cp-acc-name{font-family:var(--fh);flex:1;border:0;border-bottom:1px solid transparent;font-size:15px;font-weight:700;color:var(--navy);padding:2px 2px;background:none;}
.cp-acc-name:focus{outline:none;border-bottom-color:var(--blue);}
.cp-acc-total{font-family:var(--fh);font-size:15px;font-weight:700;color:var(--navy);font-variant-numeric:tabular-nums;}
.cp-acc-total span,.cp-line-ann span{font-family:var(--fb);font-size:11px;font-weight:500;color:var(--label);margin-left:2px;}
.cp-x{background:none;border:0;color:var(--label);font-size:20px;line-height:1;cursor:pointer;padding:0 4px;}
.cp-x:hover{color:#c0492f;} .cp-x.sm{font-size:16px;}
.cp-lines{padding:6px 20px 12px;display:flex;flex-direction:column;}
.cp-line{display:flex;align-items:center;gap:7px;padding:8px 0;border-bottom:1px solid var(--hairline-faint);}
.cp-line:last-child{border-bottom:none;}
.cp-dot{width:6px;height:6px;border-radius:50%;flex:none;}
.cp-sel{font-family:var(--fb);border:1px solid var(--hairline);border-radius:var(--rc);padding:8px;font-size:13px;font-weight:500;color:var(--navy);background:#fff;}
.cp-sel.type{font-weight:700;color:var(--navy);width:74px;}
.cp-money-in{display:flex;align-items:center;border:1px solid var(--hairline);border-radius:var(--rc);padding:0 8px;background:#fff;}
.cp-money-in span{color:var(--label);font-size:13px;}
.cp-money-in input{font-family:var(--fb);border:0;width:62px;padding:8px 4px;font-size:13px;font-weight:600;color:var(--navy);font-variant-numeric:tabular-nums;background:none;}
.cp-money-in input:focus{outline:none;} .cp-money-in em{font-style:normal;font-size:10px;color:var(--label);}
.cp-money-in.wide input{width:100%;} .cp-money-in.wide{flex:1;}
.cp-line-ann{font-family:var(--fh);margin-left:auto;font-size:14px;font-weight:700;color:var(--navy);display:flex;align-items:center;gap:6px;font-variant-numeric:tabular-nums;}
.cp-tag{font-family:var(--fb);font-style:normal;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;background:var(--group-tint);color:var(--text-2);padding:2px 6px;border-radius:var(--rc);}
.cp-add-line{font-family:var(--fb);margin:0 20px 14px;width:calc(100% - 40px);background:none;border:1px dashed var(--hairline);color:var(--blue);border-radius:var(--rc);padding:8px 12px;font-size:12px;font-weight:600;cursor:pointer;}
.cp-add-line:hover{border-color:var(--blue);background:#f2fafe;}
.cp-empty{background:#fff;border:1px dashed var(--hairline);border-radius:var(--rf);padding:28px;text-align:center;color:var(--text-2);font-size:14px;}

/* ── rail ── */
.cp-rail{display:flex;flex-direction:column;gap:18px;}
.cp-panel{background:#fff;border:1px solid var(--hairline);border-top:2px solid var(--blue);border-radius:var(--rf);padding:18px 20px;}
.cp-panel.solo{margin-top:18px;}
.cp-panel h3{font-family:var(--fh);margin:0 0 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:var(--navy);border-bottom:1px solid var(--navy);padding-bottom:10px;}
.cp-cmp-title{font-family:var(--fh);margin:0 0 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:var(--navy);border-bottom:1px solid var(--navy);padding-bottom:10px;}
.cp-cmp-chart{display:flex;flex-direction:column;gap:10px;margin-bottom:6px;}
.cp-cmp-row{display:flex;align-items:center;gap:12px;}
.cp-cmp-name{width:150px;flex-shrink:0;font-size:13px;font-weight:600;color:var(--navy);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.cp-cmp-bar-track{flex:1;height:18px;background:var(--hairline-faint);border-radius:3px;overflow:hidden;min-width:0;}
.cp-cmp-bar{display:block;height:100%;background:var(--blue);border-radius:3px;transition:width .3s ease;min-width:2px;}
.cp-cmp-row.live .cp-cmp-bar{background:var(--navy);}
.cp-cmp-val{width:78px;flex-shrink:0;text-align:right;font-family:var(--fh);font-size:13px;font-weight:700;color:var(--navy);font-variant-numeric:tabular-nums;}
.cp-spark-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:18px;}
.cp-spark-head h2{font-family:var(--fh);font-size:15px;font-weight:700;color:var(--navy);margin:0;}
.cp-spark{display:flex;flex-direction:column;gap:0;}
.cp-spark-cols{position:relative;display:flex;align-items:flex-end;gap:14px;height:150px;padding:0 4px;}
.cp-spark-plan{position:absolute;left:4px;right:4px;height:0;border-top:1.5px dashed var(--dash);z-index:2;}
.cp-spark-plan::after{content:"plan";position:absolute;right:0;top:-15px;font-family:var(--fb);font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--dash);}
.cp-spark-col{position:relative;flex:1;height:100%;display:flex;align-items:flex-end;}
.cp-spark-bar{width:100%;border-radius:3px 3px 0 0;transition:height .25s ease;}
.cp-spark-bar.ahead{background:var(--grn);}
.cp-spark-bar.behind{background:var(--blue);}
.cp-spark-bar.empty{background:transparent;border:1px dashed var(--hairline);border-bottom:none;height:0;}
.cp-spark-col.cur .cp-spark-bar{box-shadow:0 0 0 1.5px var(--navy);}
.cp-spark-val{position:absolute;left:0;right:0;text-align:center;margin-bottom:4px;transform:translateY(-100%);font-family:var(--fh);font-size:11px;font-weight:700;color:var(--navy);font-variant-numeric:tabular-nums;z-index:3;}
.cp-spark-labels{display:flex;gap:14px;padding:8px 4px 0;border-top:1px solid var(--hairline);}
.cp-spark-labels span{flex:1;text-align:center;font-family:var(--fb);font-size:12px;font-weight:600;color:var(--label);}
.cp-spark-labels span.cur{color:var(--navy);font-weight:700;}
.cp-mix{display:flex;flex-direction:column;gap:11px;}
.cp-mix-row{display:flex;align-items:center;gap:10px;}
.cp-mix-label{font-family:var(--fb);width:38px;font-size:12px;font-weight:600;color:var(--navy);}
.cp-mix-bar{flex:1;height:7px;background:var(--hairline-faint);overflow:hidden;}
.cp-mix-bar div{height:100%;transition:width .3s;}
.cp-mix-val{font-family:var(--fh);width:62px;text-align:right;font-size:13px;font-weight:700;color:var(--navy);font-variant-numeric:tabular-nums;}
.cp-qtable{width:100%;border-collapse:collapse;font-size:13px;}
.cp-qtable th{font-family:var(--fb);text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--label);padding:0 0 7px;font-weight:600;}
.cp-qtable th:last-child,.cp-qtable td:last-child{text-align:right;}
.cp-qtable td{padding:8px 0;border-top:1px solid var(--hairline-faint);font-weight:600;font-variant-numeric:tabular-nums;color:var(--text-2);}
.cp-qtable td:first-child{color:var(--navy);}
.cp-qtable td.pos{color:var(--grn-d);font-weight:700;} .cp-qtable td.muted{color:var(--dash);}
.cp-qtable tr.live td:first-child{color:var(--navy);font-weight:800;}
.cp-foot{font-size:12px;color:var(--text-2);margin:12px 0 0;line-height:1.55;font-weight:500;}

/* ── projection controls (shared) ── */
.cp-proj-controls{margin-bottom:22px;display:grid;grid-template-columns:1.1fr 1fr;gap:18px;align-items:stretch;}
.cp-sliders{display:flex;flex-direction:column;gap:14px;}
.cp-ret{background:#fff;border:1px solid var(--hairline);border-radius:var(--rf);padding:17px 19px;}
.cp-ret-head{display:flex;justify-content:space-between;align-items:baseline;}
.cp-ret-label{font-family:var(--fb);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.14em;color:var(--label);}
.cp-ret-val{font-family:var(--fh);font-size:32px;font-weight:800;color:var(--navy);font-variant-numeric:tabular-nums;}
.cp-range{width:100%;margin:9px 0 2px;accent-color:var(--blue);height:6px;}
.cp-chips{display:flex;gap:7px;margin-top:11px;}
.cp-chips button{font-family:var(--fb);flex:1;border:1px solid var(--hairline);background:#fff;color:var(--text-2);border-radius:var(--rc);padding:7px 0;font-size:12px;font-weight:600;cursor:pointer;}
.cp-chips button.on{background:var(--navy);color:#fff;border-color:var(--navy);}
.cp-ret-note{font-size:12px;color:var(--text-2);margin:13px 0 0;line-height:1.55;font-weight:500;}
.cp-proj-fields{background:#fff;border:1px solid var(--hairline);border-radius:var(--rf);padding:17px 19px;display:grid;grid-template-columns:1fr 1fr;gap:15px;align-content:start;}
.cp-mini{font-family:var(--fb);margin-top:6px;background:none;border:0;color:var(--blue);font-size:11px;font-weight:600;cursor:pointer;padding:0;text-align:left;text-transform:none;letter-spacing:0;}
.cp-mini:hover{color:var(--navy);}

/* ── multi-year chart (shared) ── */
.cp-chart-wrap{margin-bottom:22px;background:#fff;border:1px solid var(--hairline);border-radius:var(--rf);padding:22px 18px 15px;}
.cp-chart{display:flex;align-items:flex-end;gap:14px;height:210px;}
.cp-col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%;}
.cp-comm{font-family:var(--fh);text-align:center;font-size:12.5px;font-weight:700;color:var(--grn-d);height:18px;font-variant-numeric:tabular-nums;}
.cp-bar{position:relative;flex:1;display:flex;flex-direction:column-reverse;background:var(--hairline-faint);min-height:4px;}
.cp-bar-carried{background:var(--navy);width:100%;}
.cp-bar-new{background:var(--blue);width:100%;}
.cp-bar-thr{position:absolute;left:-3px;right:-3px;height:0;border-top:2px dashed var(--grn-d);z-index:3;}
.cp-bar-thr i{font-family:var(--fb);position:absolute;right:0;top:-15px;font-size:9px;font-weight:700;color:var(--grn-d);font-style:normal;background:#fff;padding:0 3px;}
.cp-col-foot{text-align:center;margin-top:8px;display:flex;flex-direction:column;}
.cp-col-foot b{font-family:var(--fh);font-size:13px;color:var(--navy);font-weight:800;font-variant-numeric:tabular-nums;}
.cp-col-foot span{font-size:11px;color:var(--label);font-weight:600;}
.cp-legend{display:flex;flex-wrap:wrap;gap:14px;margin-top:16px;border-top:1px solid var(--hairline-faint);padding-top:13px;}
.cp-legend span{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--text-2);font-weight:500;}
.cp-legend i{width:12px;height:12px;display:inline-block;}
.cp-legend i.line{height:0;border-top:2px dashed var(--grn-d);}

/* ── projection table (shared) ── */
.cp-ptable-wrap{overflow-x:auto;}
.cp-ptable{width:100%;border-collapse:collapse;font-size:13px;min-width:560px;}
.cp-ptable th{font-family:var(--fb);text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--label);padding:0 0 9px 10px;font-weight:600;}
.cp-ptable th:first-child,.cp-ptable td:first-child{text-align:left;padding-left:0;}
.cp-ptable td{padding:9px 0 9px 10px;border-top:1px solid var(--hairline-faint);text-align:right;font-weight:600;font-variant-numeric:tabular-nums;color:var(--navy);}
.cp-ptable td.muted{color:var(--dash);} .cp-ptable td.pos{color:var(--grn-d);font-weight:700;}
.cp-ptable tfoot td{border-top:2px solid var(--navy);color:var(--navy);font-weight:800;padding-top:11px;}
.cp-ptable tr.live td{background:rgba(0,155,214,.05);} .cp-ptable tr.live td:first-child{font-weight:800;}

/* ── actuals: year switcher ── */
.cp-yearsbar{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:20px;flex-wrap:wrap;}
.cp-years{display:flex;flex-wrap:wrap;gap:6px;}
.cp-years button{font-family:var(--fb);background:#fff;color:var(--navy);border:1px solid var(--hairline);border-radius:var(--rc);padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:7px;transition:background .15s ease,color .15s ease,border-color .15s ease;}
.cp-years button:hover{border-color:var(--navy);background:var(--group-tint);}
.cp-years button.on{background:var(--navy);color:#fff;border-color:var(--navy);}
.cp-years-now{font-style:normal;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;background:var(--blue);color:#fff;padding:1px 5px;border-radius:var(--rc);}
.cp-years button.on .cp-years-now{background:var(--grn);color:var(--navy);}

/* ── actuals: frozen pay snapshot ── */
.cp-snap{background:#fff;border:1px solid var(--hairline);border-top:2px solid var(--blue);border-radius:var(--rf);padding:18px 20px;margin-bottom:22px;}
.cp-snap-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap;}
.cp-snap-head .cp-eyebrow{margin-bottom:0;}
.cp-snap-date{display:block;margin-top:5px;font-size:11px;font-weight:500;color:var(--text-2);letter-spacing:.01em;}
.cp-snap-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;}
.cp-nudge{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;background:var(--amber-bg);border:1px solid var(--amber);border-left-width:3px;border-radius:var(--rf);padding:13px 16px;margin-bottom:18px;}
.cp-nudge span{font-size:13px;font-weight:600;color:var(--navy);line-height:1.5;}
.cp-nudge .cp-btn{flex:none;border-color:var(--amber);color:var(--amber-text);}
.cp-nudge .cp-btn:hover{background:var(--amber);color:#fff;}
.cp-snap-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;align-items:end;}
.cp-btn.danger{border-color:#c0492f;color:#c0492f;}
.cp-btn.danger:hover{background:#c0492f;color:#fff;}

/* ── modal dialog ── */
.cp-modal-backdrop{position:fixed;inset:0;background:rgba(20,32,48,0.42);display:flex;align-items:center;justify-content:center;padding:24px;z-index:1000;animation:cp-fade .12s ease;}
.cp-modal{background:#fff;border-radius:var(--rf);box-shadow:0 16px 48px rgba(20,32,48,0.28);max-width:420px;width:100%;padding:24px;animation:cp-pop .14s ease;}
.cp-modal-title{font-family:var(--fh);margin:0 0 8px;font-size:18px;font-weight:800;color:var(--navy);}
.cp-modal-body{margin:0 0 16px;font-size:14px;line-height:1.5;color:var(--text-2);}
.cp-modal-input{width:100%;box-sizing:border-box;margin-bottom:18px;}
.cp-modal-actions{display:flex;justify-content:flex-end;gap:10px;}
@keyframes cp-fade{from{opacity:0;}to{opacity:1;}}
@keyframes cp-pop{from{opacity:0;transform:translateY(8px) scale(.98);}to{opacity:1;transform:none;}}

/* ── toast ── */
.cp-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);display:flex;align-items:center;gap:14px;background:var(--navy);color:#fff;padding:12px 16px;border-radius:var(--rf);box-shadow:0 10px 32px rgba(20,32,48,0.32);font-size:14px;font-weight:500;z-index:1001;max-width:min(90vw,460px);animation:cp-toast-in .16s ease;}
.cp-toast.error{background:#c0492f;}
.cp-toast-msg{flex:1;}
.cp-toast-action{font-family:var(--fb);background:transparent;border:1px solid rgba(255,255,255,0.55);color:#fff;border-radius:var(--rc);padding:5px 12px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;transition:background .15s ease;}
.cp-toast-action:hover{background:rgba(255,255,255,0.16);}
.cp-toast-close{background:transparent;border:0;color:#fff;font-size:20px;line-height:1;cursor:pointer;opacity:0.75;padding:0 2px;}
.cp-toast-close:hover{opacity:1;}
@keyframes cp-toast-in{from{opacity:0;transform:translate(-50%,12px);}to{opacity:1;transform:translateX(-50%);}}

/* ── actuals: per-account ledger ── */
.cp-ledger-wrap{border:1px solid var(--navy);border-radius:var(--rf);overflow:hidden;margin-bottom:22px;}
.cp-ledger-top{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 18px;border-bottom:1px solid var(--hairline);background:var(--group-tint);}
.cp-ledger-top h2{margin:0;font-size:15px;}
.cp-ledger-scroll{overflow-x:auto;}
.cp-ledger{width:100%;border-collapse:collapse;font-size:13px;min-width:760px;}
.cp-ledger thead th{background:var(--navy);color:#fff;font-family:var(--fb);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;text-align:right;padding:11px 14px;vertical-align:bottom;}
.cp-ledger thead th.acc{text-align:left;}
.cp-ledger thead th.q .span{display:block;font-size:9px;font-weight:500;letter-spacing:.02em;color:var(--on-navy-muted);margin-top:3px;text-transform:none;}
.cp-ledger thead th.cur{background:#234668;}
.cp-ledger tbody td{padding:0;border-top:1px solid var(--hairline-faint);font-variant-numeric:tabular-nums;color:var(--text-2);}
.cp-ledger tbody td.acc{padding:10px 14px;color:var(--navy);font-weight:700;text-align:left;}
.cp-ledger tbody td.acc .tag{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;background:var(--amber-bg);color:var(--amber-text);padding:1px 6px;border-radius:var(--rc);margin-left:8px;vertical-align:middle;}
.cp-ledger tbody td.acc.empty{color:var(--text-2);font-weight:500;}
.cp-ledger tbody td.num{padding:10px 14px;text-align:right;font-weight:600;}
.cp-ledger tbody td.fc{color:var(--label);}
.cp-ledger tbody td.total{color:var(--navy);font-weight:800;}
.cp-ledger tbody td.delta.pos{color:var(--grn-d);font-weight:700;} .cp-ledger tbody td.delta.neg{color:var(--amber-text);font-weight:700;} .cp-ledger tbody td.delta.muted{color:var(--dash);}
.cp-ledger tbody tr.orphan td.acc .nm{color:var(--text-2);}
.cp-ledger td.cell{padding:0;position:relative;}
.cp-ledger td.cell input{width:100%;border:0;background:none;padding:10px 14px;font-family:var(--fb);font-size:13px;font-weight:600;color:var(--navy);text-align:right;font-variant-numeric:tabular-nums;}
.cp-ledger td.cell input:focus{outline:none;box-shadow:inset 0 0 0 2px var(--blue);background:#fff;}
.cp-ledger td.cell.cur{background:rgba(0,155,214,.06);}
.cp-ledger td.cell.future input{color:var(--dash);}
.cp-ledger td.cell.future{background:repeating-linear-gradient(45deg,transparent,transparent 5px,rgba(184,194,204,.10) 5px,rgba(184,194,204,.10) 10px);}
.cp-ledger tfoot td{background:var(--group-tint);border-top:2px solid var(--navy);padding:11px 14px;text-align:right;font-weight:800;color:var(--navy);font-variant-numeric:tabular-nums;}
.cp-ledger tfoot td.acc{text-align:left;}
.cp-ledger tfoot td.cur{background:rgba(0,155,214,.10);}
.cp-ledger tfoot td.delta.pos{color:var(--grn-d);} .cp-ledger tfoot td.delta.neg{color:var(--amber-text);}
.cp-panel.solo{margin-bottom:0;}

/* ── footer ── */
.cp-footer{display:flex;align-items:center;justify-content:center;gap:9px;margin-top:34px;padding-top:18px;border-top:1px solid var(--hairline);font-size:12px;color:var(--text-2);font-weight:500;letter-spacing:.01em;}

/* ── focus states ── */
.cp-input,.cp-sel,.cp-acc-name,.cp-money-in{transition:border-color .15s ease, box-shadow .15s ease;}
.cp-input:focus,.cp-sel:focus,.cp-money-in:focus-within{outline:none;border-color:var(--blue);box-shadow:0 0 0 3px rgba(0,155,214,.13);}

/* ── feature additions ── */
.cp-target-caption{margin-top:9px;font-size:13px;color:var(--text-2);font-weight:500;}
.cp-target-caption b{color:var(--navy);font-weight:700;} .cp-target-caption .pos{color:var(--grn-d);}
.cp-actuals-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:18px;}
.cp-panel-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:4px;}
.cp-panel-head h3{margin:0;}
.cp-section-head.wide{align-items:flex-start;}
.cp-section-head.wide h2{margin:0;}
.cp-proj-controls.solo-head{display:block;}
.cp-qtable td.neg{color:var(--amber-text);font-weight:700;}
.cp-row-actions{white-space:nowrap;text-align:right;}
.cp-row-actions .cp-mini{display:inline-block;margin:0 0 0 12px;}
.cp-mini.danger{color:#c0492f;} .cp-mini.danger:hover{color:#8f2f1c;}
.cp-live-row td{background:rgba(0,155,214,.05);}
.neg{color:var(--amber-text);}

/* ── account tools, search, card controls ── */
.cp-count{font-family:var(--fb);font-size:13px;font-weight:500;color:var(--label);margin-left:6px;}
.cp-acc-tools{display:flex;align-items:center;gap:14px;flex-wrap:wrap;}
.cp-search{position:relative;display:flex;align-items:center;}
.cp-search input{font-family:var(--fb);border:1px solid var(--hairline);border-radius:var(--rc);padding:8px 26px 8px 11px;font-size:13px;font-weight:500;color:var(--navy);background:#fff;width:190px;}
.cp-search input:focus{outline:none;border-color:var(--blue);box-shadow:0 0 0 3px rgba(0,155,214,.13);}
.cp-search-clear{position:absolute;right:6px;background:none;border:0;color:var(--label);font-size:16px;line-height:1;cursor:pointer;padding:0 2px;}
.cp-search-clear:hover{color:var(--navy);}
.cp-sort{font-family:var(--fb);border:1px solid var(--hairline);border-radius:var(--rc);padding:8px 9px;font-size:13px;font-weight:500;color:var(--navy);background:#fff;cursor:pointer;}
.cp-sort:focus{outline:none;border-color:var(--blue);box-shadow:0 0 0 3px rgba(0,155,214,.13);}
.cp-collapse{font-family:var(--fb);background:none;border:0;color:var(--blue);font-size:13px;font-weight:600;line-height:1;cursor:pointer;padding:2px 4px;flex:none;}
.cp-collapse:hover{color:var(--navy);}
.cp-card-actions{display:flex;align-items:center;gap:2px;flex:none;}
.cp-iconbtn{background:none;border:0;color:var(--text-2);font-size:14px;line-height:1;cursor:pointer;padding:4px 5px;border-radius:var(--rc);}
.cp-iconbtn:hover{color:var(--navy);background:var(--group-tint);}
.cp-iconbtn:disabled{opacity:.32;cursor:default;background:none;}
.cp-wtag{font-family:var(--fb);font-style:normal;font-size:10px;font-weight:600;color:var(--blue);margin-left:7px;}
.cp-card-meta{display:flex;align-items:center;gap:18px;padding:10px 20px;border-top:1px solid var(--hairline-faint);flex-wrap:wrap;background:#fff;}
.cp-toggle{display:flex;align-items:center;gap:7px;font-family:var(--fb);font-size:12px;font-weight:600;color:var(--text-2);cursor:pointer;}
.cp-toggle input{width:15px;height:15px;accent-color:var(--grn-d);cursor:pointer;}
.cp-conf{display:flex;align-items:center;gap:8px;font-family:var(--fb);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-2);}
.cp-conf input[type=range]{width:96px;accent-color:var(--blue);cursor:pointer;}
.cp-conf-num{font-family:var(--fb);width:58px;border:1px solid var(--hairline);border-radius:var(--rc);padding:5px 7px;font-size:12px;font-weight:600;color:var(--navy);background:#fff;font-variant-numeric:tabular-nums;}
.cp-conf-num:focus{outline:none;border-color:var(--blue);}
.cp-conf em{font-style:normal;}
.cp-card.excluded{opacity:.6;}
.cp-card.excluded .cp-acc-total{color:var(--label);}

/* ── pipeline & risk weighted bars ── */
.cp-wbars{display:flex;flex-direction:column;gap:11px;margin-bottom:4px;}
.cp-wbar-row{display:flex;align-items:center;gap:10px;}
.cp-wbar-label{font-family:var(--fb);width:74px;font-size:11px;font-weight:600;color:var(--label);text-transform:uppercase;letter-spacing:.06em;}
.cp-wbar-val{font-family:var(--fh);width:62px;text-align:right;font-size:13px;font-weight:700;color:var(--navy);font-variant-numeric:tabular-nums;}
.cp-wbar{flex:1;height:6px;background:var(--hairline-faint);overflow:hidden;}
.cp-wbar div{height:100%;transition:width .3s;}

/* ── fiscal year chip + payout ── */
.cp-yearbar{font-size:11px;color:var(--text-2);background:var(--hairline-faint);border-radius:var(--rc);padding:6px 10px;margin-bottom:12px;position:relative;overflow:hidden;}
.cp-yearbar-fill{position:absolute;left:0;top:0;bottom:0;background:rgba(0,155,214,.10);}
.cp-yearbar-label{position:relative;z-index:1;font-family:var(--fb);font-weight:500;color:var(--text-2);}
.cp-now{font-family:var(--fb);font-style:normal;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;background:var(--blue);color:#fff;padding:1px 5px;border-radius:var(--rc);margin-left:6px;vertical-align:middle;}
.cp-qtable tr.now td{background:rgba(0,155,214,.05);}

/* B2 — Commission Manifest: hidden on screen, the only thing shown in print */
.cp-manifest{display:none;}
@media print{
  /* hide the live app chrome entirely; print just the manifest */
  .cp-header,.cp-meta,.cp-eyebrow,.cp-titlerow,.cp-settings,.cp-tabpanel,.cp-nudge,.cp-footer,.cp-toast,.cp-modal-backdrop{display:none !important;}
  .cp-root{width:auto;max-width:none;padding:0;margin:0;}
  body,html,#root{background:#fff !important;}
  .cp-manifest{display:block !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  @page{margin:14mm;}
}
.cp-mf-head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding-bottom:14px;border-bottom:2px solid var(--navy);}
.cp-mf-brand{display:flex;flex-direction:column;gap:2px;}
.cp-mf-ft{font-family:var(--fh);font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--blue);}
.cp-mf-doc{font-family:var(--fh);font-size:26px;font-weight:800;letter-spacing:-.02em;color:var(--navy);line-height:1.05;}
.cp-mf-meta{display:grid;grid-template-columns:auto auto;gap:4px 22px;text-align:right;}
.cp-mf-meta div{display:flex;flex-direction:column;}
.cp-mf-meta span{font-family:var(--fb);font-size:9px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--label);}
.cp-mf-meta b{font-family:var(--fh);font-size:12px;font-weight:700;color:var(--navy);}
.cp-mf-cols{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:18px;}
.cp-mf-block{break-inside:avoid;}
.cp-mf-block.wide{margin-top:18px;}
.cp-mf-block h3{font-family:var(--fh);font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--navy);margin:0 0 8px;padding-bottom:5px;border-bottom:1px solid var(--hairline);}
.cp-mf-block dl{margin:0;}
.cp-mf-block dl>div{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:4px 0;border-bottom:1px solid var(--hairline-faint);}
.cp-mf-block dt{font-family:var(--fb);font-size:12px;color:var(--text-2);}
.cp-mf-block dd{margin:0;font-family:var(--fh);font-size:13px;font-weight:700;color:var(--navy);font-variant-numeric:tabular-nums;}
.cp-mf-block dl>div.hi dd{color:var(--grn-d);font-size:15px;}
.cp-mf-bands{margin-top:8px;display:flex;flex-direction:column;gap:3px;}
.cp-mf-band{display:flex;justify-content:space-between;font-family:var(--fb);font-size:11px;color:var(--text-2);background:var(--group-tint);padding:3px 8px;border-radius:3px;}
.cp-mf-band b{font-family:var(--fh);color:var(--navy);}
.cp-mf-table{width:100%;border-collapse:collapse;margin-top:2px;}
.cp-mf-table th,.cp-mf-table td{font-family:var(--fb);font-size:11px;text-align:left;padding:6px 8px;border-bottom:1px solid var(--hairline);}
.cp-mf-table th{font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--label);background:var(--group-tint);}
.cp-mf-table td{color:var(--navy);font-variant-numeric:tabular-nums;}
.cp-mf-table .n{text-align:right;}
.cp-mf-table tfoot td{font-family:var(--fh);font-weight:700;border-top:2px solid var(--navy);border-bottom:none;}
.cp-mf-foot{margin-top:18px;padding-top:10px;border-top:1px solid var(--hairline);font-family:var(--fb);font-size:9.5px;line-height:1.5;color:var(--label);}

@media(max-width:900px){
  .cp-meta{grid-template-columns:1fr 1fr;}
  .cp-meta-cell:nth-child(2){border-right:none;}
  .cp-meta-cell:nth-child(1),.cp-meta-cell:nth-child(2){border-bottom:1px solid var(--hairline);}
  .cp-hero{grid-template-columns:1fr;}
  .cp-instr{border-right:none;border-bottom:1px solid var(--navy);}
  .cp-stats,.cp-settings{grid-template-columns:repeat(2,1fr);}
  .cp-stat{border-bottom:1px solid var(--hairline);}
  .cp-stats.three{grid-template-columns:1fr;}
  .cp-grid,.cp-proj-controls,.cp-actuals-grid{grid-template-columns:1fr;}
  .cp-snap-grid{grid-template-columns:repeat(2,1fr);}
}
@media(max-width:560px){
  .cp-root{width:92%;padding:32px 0 48px;}
  .cp-title{font-size:34px;}
  .cp-meta{grid-template-columns:1fr;}
  .cp-meta-cell{border-right:none;border-bottom:1px solid var(--hairline);}
  .cp-meta-cell:last-child{border-bottom:none;}
  .cp-stats{grid-template-columns:1fr 1fr;}
  .cp-settings,.cp-snap-grid{grid-template-columns:1fr;}
  .cp-rail .cp-panel{overflow-x:auto;}
  .cp-gauge{flex-wrap:wrap;gap:14px;}
  .cp-line{flex-wrap:wrap;} .cp-line-ann{margin-left:0;}
  .cp-proj-fields{grid-template-columns:1fr;}
}
`;
