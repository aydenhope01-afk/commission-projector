/* ─────────────────────────────────────────────────────────────────────────
   Commission Projector — pure engine + data helpers
   ─────────────────────────────────────────────────────────────────────────
   Everything here is framework-free (no React, no Supabase) and, aside from the
   currency-formatting singleton, side-effect-free — so it can be unit-tested in
   isolation. The UI in CommissionProjector.jsx imports from this module.
   ───────────────────────────────────────────────────────────────────────── */

/* ───────────────────────── constants ───────────────────────── */
export const TYPE_DEFAULTS = { FCL: 500, LCL: 300, AIR: 300, RORO: 1500 };
export const TYPES = ["FCL", "LCL", "AIR", "RORO"];

export const FREQS = [
  { key: "weekly", label: "Weekly", mult: 52 },
  { key: "fortnightly", label: "Fortnightly", mult: 26 },
  { key: "monthly", label: "Monthly", mult: 12 },
  { key: "quarterly", label: "Quarterly", mult: 4 },
  { key: "yearly", label: "Yearly", mult: 1 },
  { key: "one-off", label: "One-off", mult: 1 },
];
export const FREQ_MULT = Object.fromEntries(FREQS.map((f) => [f.key, f.mult]));

/* brand-aligned type colours: navy / blue / green / light blue */
export const TYPE_COLOR = { FCL: "#1C3857", LCL: "#009BD6", AIR: "#5FB8E2", RORO: "#72C481" };

export const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : "id" + Math.random().toString(36).slice(2);

/* Currency/locale is user-configurable. CUR is updated from settings at the top of
   each render (synchronous, so all formatting in the same pass uses fresh values). */
export const CUR = { locale: "en-AU", currency: "AUD", sym: "$" };
export const CURRENCIES = [
  { code: "AUD", locale: "en-AU", label: "AUD — Australian dollar" },
  { code: "USD", locale: "en-US", label: "USD — US dollar" },
  { code: "NZD", locale: "en-NZ", label: "NZD — NZ dollar" },
  { code: "GBP", locale: "en-GB", label: "GBP — Pound sterling" },
  { code: "EUR", locale: "en-IE", label: "EUR — Euro" },
  { code: "SGD", locale: "en-SG", label: "SGD — Singapore dollar" },
  { code: "CAD", locale: "en-CA", label: "CAD — Canadian dollar" },
];
export function fmtMoney(n, dp) {
  try {
    return new Intl.NumberFormat(CUR.locale, {
      style: "currency", currency: CUR.currency, currencyDisplay: "narrowSymbol",
      minimumFractionDigits: dp, maximumFractionDigits: dp,
    }).format(n || 0);
  } catch {
    return CUR.sym + (n || 0).toLocaleString(CUR.locale, { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
}
export function currencySymbol() {
  try {
    const parts = new Intl.NumberFormat(CUR.locale, { style: "currency", currency: CUR.currency, currencyDisplay: "narrowSymbol" }).formatToParts(0);
    const p = parts.find((x) => x.type === "currency");
    return p ? p.value : "$";
  } catch { return "$"; }
}
export const A$ = (n) => fmtMoney(Math.round(n || 0), 0);
export const A$2 = (n) => fmtMoney(n || 0, 2);

/* Re-sync the CUR formatting singleton from settings. Called at the top of each
   render so all synchronous formatting in that pass uses the chosen currency.
   Encapsulated here (rather than mutating CUR in the component body) to keep the
   render function free of external mutation. */
export function applyCurrency(code) {
  CUR.currency = code || "AUD";
  CUR.locale = (CURRENCIES.find((c) => c.code === CUR.currency) || {}).locale || "en-AU";
  CUR.sym = currencySymbol();
}

/* Derive the sales-rep display name + a stable document code from the signed-in
   user, so the manifest header is correct per user (no hardcoded identity).
   Falls back gracefully when no user is supplied (e.g. preview). */
export function repIdentity(user) {
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

export const DEFAULT_SETTINGS = { base: 70000, car: 15000, multiplier: 2.5, rate: 10, target: 0, fiscalYearStart: 7, currency: "AUD", tiers: [] };
// Ensure every accelerator band carries a stable id, so React list keys don't
// fall back to the array index (which is unstable when bands are removed). Pure:
// returns a new settings object; tierCommission ignores the id field entirely.
export function withTierIds(settings) {
  if (!settings) return settings;
  const tiers = Array.isArray(settings.tiers) ? settings.tiers.map((t) => (t && t.id ? t : { ...t, id: uid() })) : [];
  return { ...settings, tiers };
}
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/* Fiscal-year + "today" awareness. fyStartMonth is 1-12. */
export function fiscalInfo(fyStartMonth, today = new Date()) {
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
export const DEFAULT_PROJ = { retention: 85, years: 5, newPerYear: null, newGrowth: 100, payRise: 0, discount: 0 };

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
export const QKEYS = ["q1", "q2", "q3", "q4"];
export const DEFAULT_ACTUALS = { v: 2, names: {}, years: {} };
export function migrateActuals(a) {
  if (!a || typeof a !== "object" || a.v !== 2) return { v: 2, names: {}, years: {} };
  return { v: 2, names: a.names || {}, years: a.years || {} };
}
export function emptyCells() { return { q1: null, q2: null, q3: null, q4: null }; }
/* short month-range labels for each fiscal quarter, e.g. "Jul–Sep" */
export function quarterSpans(fyStartMonth) {
  const m = (Number(fyStartMonth) || 1) - 1;
  return [0, 1, 2, 3].map((q) => `${MONTHS[(m + q * 3) % 12].slice(0, 3)}–${MONTHS[(m + q * 3 + 2) % 12].slice(0, 3)}`);
}
/* fiscal-year label from a start year, e.g. 2025 → "FY25/26" (or "2025" if calendar) */
export function fyLabelFor(startYear, fyStartMonth) {
  const m = (Number(fyStartMonth) || 1) - 1;
  if (m === 0) return `${startYear}`;
  return `FY${String(startYear).slice(2)}/${String(startYear + 1).slice(2)}`;
}
export const seedAccounts = () => [
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
export function tierCommission(gpIn, threshold, baseRatePct, tiers) {
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
export function gpForCommission(targetComm, threshold, baseRatePct, tiers) {
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

export function computeCalc(accounts, settings) {
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

export function computeProjection(calc, settings, proj) {
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
export function accountIdsForYear(yearEntry, accounts) {
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
export function computeYear(yearEntry, accounts, names, isCurrent, frac) {
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
export function computeHistory(actuals, accounts, names) {
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
