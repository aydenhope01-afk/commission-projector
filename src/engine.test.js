import { describe, it, expect, beforeEach } from "vitest";
import {
  tierCommission, gpForCommission, computeCalc, computeProjection,
  computeYear, computeHistory, accountIdsForYear, fiscalInfo,
  quarterSpans, fyLabelFor, withTierIds, migrateActuals, emptyCells,
  seedAccounts, repIdentity, applyCurrency, A$, A$2, fmtMoney,
  DEFAULT_SETTINGS, DEFAULT_PROJ, FREQ_MULT,
} from "./engine";

// Standard package used across cases: base 70k + car 15k = 85k, ×2.5 = 212,500 line.
const COMP = { base: 70000, car: 15000, multiplier: 2.5, rate: 10, tiers: [] };
const THR = 212500;
const acct = (lines, extra = {}) => ({ id: extra.id || "a", name: extra.name || "A", lines, ...extra });
const line = (type, freq, profit) => ({ id: type + freq, type, freq, profit });

describe("tierCommission", () => {
  it("flat rate above the line", () => {
    expect(tierCommission(300000, THR, 10, [])).toBe((300000 - THR) * 0.1);
  });
  it("is zero at or below the line", () => {
    expect(tierCommission(THR, THR, 10, [])).toBe(0);
    expect(tierCommission(100000, THR, 10, [])).toBe(0);
  });
  it("applies marginal accelerator bands above their breakpoints", () => {
    // 10% from 212,500; 15% above 1.5× (318,750). GP 400,000:
    //   (318,750-212,500)*0.10 + (400,000-318,750)*0.15 = 10,625 + 12,187.5
    expect(tierCommission(400000, THR, 10, [{ atMult: 1.5, rate: 15 }])).toBeCloseTo(22812.5, 4);
  });
  it("sorts unsorted bands and ignores breakpoints at/below the line", () => {
    const a = tierCommission(500000, THR, 10, [{ atMult: 3, rate: 25 }, { atMult: 1.5, rate: 15 }]);
    const b = tierCommission(500000, THR, 10, [{ atMult: 1.5, rate: 15 }, { atMult: 3, rate: 25 }]);
    expect(a).toBeCloseTo(b, 6);
    // atMult <= 1 is not > threshold, so it is filtered out -> pure flat.
    expect(tierCommission(300000, THR, 10, [{ atMult: 1, rate: 50 }])).toBeCloseTo((300000 - THR) * 0.1, 6);
  });
  it("reduces exactly to the legacy flat calc with no/garbage tiers", () => {
    for (const tiers of [[], null, undefined]) {
      for (const gp of [0, 100000, 300000, 1e6]) {
        expect(tierCommission(gp, THR, 10, tiers)).toBe(Math.max(0, gp - THR) * 0.1);
      }
    }
  });
  it("is monotonic non-decreasing in GP", () => {
    const tiers = [{ atMult: 1.5, rate: 15 }, { atMult: 3, rate: 25 }];
    let prev = -1;
    for (let gp = 0; gp <= 2_000_000; gp += 10000) {
      const c = tierCommission(gp, THR, 10, tiers);
      expect(c).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = c;
    }
  });
  it("coerces non-finite GP to $0 (corrupt data never yields NaN)", () => {
    for (const bad of [NaN, undefined, "x", null]) {
      expect(Number.isFinite(tierCommission(bad, THR, 10, []))).toBe(true);
    }
    expect(tierCommission(NaN, THR, 10, [{ atMult: 1.5, rate: 15 }])).toBe(0);
  });
  it("handles a zero threshold without throwing", () => {
    expect(Number.isFinite(tierCommission(100000, 0, 10, [{ atMult: 1.5, rate: 15 }]))).toBe(true);
  });
});

describe("gpForCommission (inverse)", () => {
  it("inverts the flat calc", () => {
    expect(gpForCommission(8750, THR, 10, [])).toBeCloseTo(300000, 4);
  });
  it("returns threshold for a zero/negative target", () => {
    expect(gpForCommission(0, THR, 10, [])).toBe(THR);
    expect(gpForCommission(-50, THR, 10, [])).toBe(THR);
  });
  it("returns Infinity when unreachable (0% with no accelerator)", () => {
    expect(gpForCommission(1000, THR, 0, [])).toBe(Infinity);
  });
  it("round-trips with tierCommission across tier sets/thresholds/rates", () => {
    const tierSets = [
      [], [{ atMult: 1.5, rate: 15 }],
      [{ atMult: 1.5, rate: 15 }, { atMult: 2, rate: 20 }, { atMult: 3, rate: 25 }],
      [{ atMult: 2, rate: 0 }, { atMult: 3, rate: 30 }],
    ];
    for (const tiers of tierSets)
      for (const threshold of [212500, 100000, 1])
        for (const rate of [10, 7.5])
          for (const gp of [threshold * 1.3, threshold * 2.1, threshold * 5]) {
            const comm = tierCommission(gp, threshold, rate, tiers);
            if (comm <= 0) continue;
            const gpBack = gpForCommission(comm, threshold, rate, tiers);
            expect(Number.isFinite(gpBack)).toBe(true);
            expect(tierCommission(gpBack, threshold, rate, tiers)).toBeCloseTo(comm, 4);
          }
  });
});

describe("computeCalc", () => {
  it("totals the seed book correctly", () => {
    const c = computeCalc(seedAccounts(), DEFAULT_SETTINGS);
    expect(c.pkg).toBe(85000);
    expect(c.threshold).toBe(THR);
    expect(c.totalGP).toBe(44000); // 500*52 + 1500*12
    expect(c.byType).toMatchObject({ FCL: 26000, RORO: 18000, LCL: 0, AIR: 0 });
    expect(c.commission).toBe(0); // below the line
    expect(c.gap).toBe(THR - 44000);
    expect(c.over).toBe(0);
  });
  it("separates one-off from recurring GP", () => {
    const accts = [acct([line("FCL", "weekly", 500), line("AIR", "one-off", 10000)])];
    const c = computeCalc(accts, DEFAULT_SETTINGS);
    expect(c.totalGP).toBe(26000 + 10000);
    expect(c.oneOffGP).toBe(10000);
    expect(c.recurringGP).toBe(26000);
  });
  it("excludes accounts flagged included:false", () => {
    const accts = [acct([line("FCL", "weekly", 500)], { id: "in" }), acct([line("FCL", "weekly", 500)], { id: "ex", included: false })];
    const c = computeCalc(accts, DEFAULT_SETTINGS);
    expect(c.totalGP).toBe(26000);
    expect(c.excludedCount).toBe(1);
    expect(c.accTotals.ex).toBe(26000); // still computed per-account for display
  });
  it("confidence-weights expected GP without changing committed total", () => {
    const accts = [acct([line("FCL", "weekly", 500)], { confidence: 50 })];
    const c = computeCalc(accts, DEFAULT_SETTINGS);
    expect(c.totalGP).toBe(26000);
    expect(c.weightedGP).toBe(13000);
  });
  it("computes concentration of the top account", () => {
    const c = computeCalc(seedAccounts(), DEFAULT_SETTINGS);
    expect(c.concentration.name).toBe("Weekly China importer");
    expect(c.concentration.pct).toBeCloseTo((26000 / 44000) * 100, 4);
  });
  it("quarterly payments sum to the annual commission", () => {
    const accts = [acct([line("FCL", "weekly", 6000)])]; // 312,000 GP, over the line
    const c = computeCalc(accts, DEFAULT_SETTINGS);
    const sum = c.quarters.reduce((s, q) => s + q.payment, 0);
    expect(sum).toBeCloseTo(c.commission, 4);
  });
});

describe("computeProjection", () => {
  const calc = { pkg: 85000, totalGP: 250000, recurringGP: 250000 };
  it("produces one row per projected year", () => {
    const p = computeProjection(calc, COMP, { ...DEFAULT_PROJ, years: 5 });
    expect(p.rows).toHaveLength(5);
    expect(p.rows.map((r) => r.y)).toEqual([1, 2, 3, 4, 5]);
  });
  it("year 1 is the current book; later years carry recurring at retention + add new", () => {
    const p = computeProjection(calc, COMP, { ...DEFAULT_PROJ, retention: 85, newGrowth: 100, newPerYear: 250000, years: 2, discount: 0, payRise: 0 });
    expect(p.rows[0].carried).toBe(0);
    expect(p.rows[0].total).toBe(250000);
    expect(p.rows[1].carried).toBeCloseTo(250000 * 0.85, 4);
    expect(p.rows[1].newGP).toBeCloseTo(250000, 4);
    expect(p.rows[1].total).toBeCloseTo(250000 * 0.85 + 250000, 4);
  });
  it("grows the threshold with an annual pay rise", () => {
    const p = computeProjection(calc, COMP, { ...DEFAULT_PROJ, payRise: 5000, years: 3 });
    expect(p.rows[0].pkg).toBe(85000);
    expect(p.rows[1].pkg).toBe(90000);
    expect(p.rows[1].threshold).toBe(90000 * 2.5);
    expect(p.rows[2].pkg).toBe(95000);
  });
  it("discounts later years to present value; year 1 undiscounted", () => {
    const p = computeProjection(calc, COMP, { ...DEFAULT_PROJ, discount: 10, years: 3 });
    expect(p.rows[0].pvComm).toBe(p.rows[0].commission); // year 1 undiscounted
    expect(p.rows[1].pvComm).toBeCloseTo(p.rows[1].commission / 1.1, 4);
    expect(p.rows[2].pvComm).toBeCloseTo(p.rows[2].commission / 1.21, 4);
    expect(p.npvComm).toBeLessThanOrEqual(p.cumComm + 1e-6);
  });
  it("cumComm equals the sum of yearly commission", () => {
    const p = computeProjection(calc, COMP, { ...DEFAULT_PROJ, years: 5 });
    expect(p.cumComm).toBeCloseTo(p.rows.reduce((s, r) => s + r.commission, 0), 4);
  });
  it("stays finite/non-negative across a parameter sweep", () => {
    for (const retention of [0, 70, 100])
      for (const newGrowth of [0, 100, 200])
        for (const discount of [0, 8, 15])
          for (const newPerYear of [null, 0, 300000]) {
            const p = computeProjection(calc, { ...COMP, tiers: [{ atMult: 1.5, rate: 15 }] }, { ...DEFAULT_PROJ, retention, newGrowth, discount, newPerYear, years: 7 });
            for (const r of p.rows)
              for (const k of ["pkg", "threshold", "carried", "newGP", "total", "commission", "pvComm", "earnings", "cumComm"]) {
                expect(Number.isFinite(r[k])).toBe(true);
                expect(r[k]).toBeGreaterThanOrEqual(-1e-6);
              }
          }
  });
});

describe("fiscalInfo", () => {
  it("July-start FY around 30 Jun 2026 is FY25/26, Q4, ~100% elapsed", () => {
    const fi = fiscalInfo(7, new Date(2026, 5, 30));
    expect(fi.label).toBe("FY25/26");
    expect(fi.quarter).toBe(4);
    expect(fi.start.getFullYear()).toBe(2025);
    expect(fi.frac).toBeGreaterThan(0.95);
    expect(fi.calendar).toBe(false);
  });
  it("January start is a calendar year", () => {
    const fi = fiscalInfo(1, new Date(2026, 0, 2));
    expect(fi.calendar).toBe(true);
    expect(fi.label).toBe("2026");
    expect(fi.quarter).toBe(1);
  });
  it("quarter in 1..4 and frac in [0,1) for every month start and day of year", () => {
    for (let sm = 1; sm <= 12; sm++)
      for (let d = 0; d < 365; d++) {
        const fi = fiscalInfo(sm, new Date(2026, 0, 1 + d));
        expect(fi.quarter).toBeGreaterThanOrEqual(1);
        expect(fi.quarter).toBeLessThanOrEqual(4);
        expect(fi.frac).toBeGreaterThanOrEqual(0);
        expect(fi.frac).toBeLessThan(1.0000001);
      }
  });
});

describe("actuals: computeYear / computeHistory / accountIdsForYear", () => {
  it("keeps removed-but-historied accounts as orphans with correct totals", () => {
    const entry = { comp: COMP, forecast: { a1: 50000, a2: 60000 }, cells: { a1: { q1: 10000, q2: 10000 }, a2: { q1: 20000 } } };
    const yd = computeYear(entry, [{ id: "a2", name: "Kept" }], { a1: "Old Client" }, false, 1);
    const orphan = yd.perAcc.find((r) => r.id === "a1");
    expect(orphan.orphan).toBe(true);
    expect(orphan.name).toBe("Old Client");
    expect(orphan.sum).toBe(20000);
    expect(yd.ytd).toBe(40000);
    expect(yd.forecastTotal).toBe(110000);
  });
  it("sanitizes corrupt cell/forecast values to clean numbers", () => {
    const bad = { comp: COMP, forecast: { a: "oops" }, cells: { a: { q1: "abc", q2: 5000 } } };
    const yd = computeYear(bad, [{ id: "a", name: "A" }], {}, false, 1);
    expect(yd.ytd).toBe(5000); // non-numeric q1 dropped
    expect(yd.forecastTotal).toBe(0); // non-numeric forecast -> 0
    expect(Number.isFinite(yd.commission)).toBe(true);
  });
  it("plan-to-date scales by elapsed fraction for the current year", () => {
    const entry = { comp: COMP, forecast: { a: 100000 }, cells: { a: { q1: 30000 } } };
    const yd = computeYear(entry, [{ id: "a", name: "A" }], {}, true, 0.5);
    expect(yd.planToDate).toBe(50000);
    expect(yd.pace).toBe(30000 - 50000);
    expect(yd.runRate).toBe(30000 * 4); // one quarter entered, annualised
  });
  it("history: retention = thisActual/prevActual and cumulative commission", () => {
    const actuals = { years: {
      2024: { comp: COMP, forecast: { a: 100000 }, cells: { a: { q1: 100000, q2: 100000, q3: 30000, q4: 30000 } } }, // 260,000
      2025: { comp: COMP, forecast: { a: 100000 }, cells: { a: { q1: 80000, q2: 80000, q3: 40000 } } },             // 200,000
    } };
    const h = computeHistory(actuals, [{ id: "a", name: "A" }], {});
    const [r24, r25] = h.rows;
    expect(r24.retention).toBeNull();
    expect(r25.retention).toBeCloseTo((200000 / 260000) * 100, 4);
    expect(r24.commission).toBeCloseTo((260000 - THR) * 0.1, 4); // 4,750
    expect(r25.commission).toBe(0); // below the line
    expect(h.cumCommission).toBeCloseTo(4750, 4);
  });
  it("accountIdsForYear dedupes, keeps live first, and includes history-only ids", () => {
    const ids = accountIdsForYear({ forecast: { x: 1 }, cells: { a2: {} } }, [{ id: "a1" }, { id: "a2" }, { id: "a1" }]);
    expect(ids).toEqual(["a1", "a2", "x"]);
  });
});

describe("data helpers", () => {
  it("withTierIds adds ids and preserves existing ones", () => {
    const out = withTierIds({ tiers: [{ atMult: 1.5, rate: 15 }, { id: "keep", atMult: 2, rate: 20 }] });
    expect(out.tiers[0].id).toBeTruthy();
    expect(out.tiers[1].id).toBe("keep");
    expect(withTierIds({}).tiers).toEqual([]);
  });
  it("migrateActuals passes v2 through and resets anything else", () => {
    const v2 = { v: 2, names: { a: "A" }, years: { 2025: {} } };
    expect(migrateActuals(v2)).toEqual(v2);
    expect(migrateActuals({ v: 1 })).toEqual({ v: 2, names: {}, years: {} });
    expect(migrateActuals(null)).toEqual({ v: 2, names: {}, years: {} });
  });
  it("emptyCells returns four null quarters", () => {
    expect(emptyCells()).toEqual({ q1: null, q2: null, q3: null, q4: null });
  });
  it("quarterSpans labels each fiscal quarter from the start month", () => {
    expect(quarterSpans(7)).toEqual(["Jul–Sep", "Oct–Dec", "Jan–Mar", "Apr–Jun"]);
    expect(quarterSpans(1)).toEqual(["Jan–Mar", "Apr–Jun", "Jul–Sep", "Oct–Dec"]);
  });
  it("fyLabelFor formats fiscal vs calendar years", () => {
    expect(fyLabelFor(2025, 7)).toBe("FY25/26");
    expect(fyLabelFor(2025, 1)).toBe("2025");
  });
  it("FREQ_MULT maps frequencies to annual multipliers", () => {
    expect(FREQ_MULT).toMatchObject({ weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4, yearly: 1, "one-off": 1 });
  });
});

describe("repIdentity", () => {
  it("derives a display name from the email local part", () => {
    expect(repIdentity({ email: "ayden.hope@freighttasker.com" }).name).toBe("Ayden Hope");
  });
  it("prefers explicit metadata name", () => {
    expect(repIdentity({ email: "x@y.com", user_metadata: { full_name: "Jane Doe" } }).name).toBe("Jane Doe");
  });
  it("falls back to em dash with no user, and gives a stable CP-#### doc per id", () => {
    expect(repIdentity({}).name).toBe("—");
    const a = repIdentity({ id: "abc" }).doc;
    expect(a).toMatch(/^CP-\d{4}$/);
    expect(repIdentity({ id: "abc" }).doc).toBe(a); // deterministic
  });
});

describe("currency formatting", () => {
  beforeEach(() => applyCurrency("AUD"));
  it("A$ rounds to whole units with grouping", () => {
    expect(A$(1000)).toContain("1,000");
    expect(A$(1234.4)).toContain("1,234");
    expect(A$(0)).toContain("0");
  });
  it("A$2 keeps two decimals", () => {
    expect(A$2(1000.5)).toContain("1,000.50");
  });
  it("guards null/NaN to zero", () => {
    expect(A$(null)).toContain("0");
    expect(fmtMoney(NaN, 0)).toContain("0");
  });
  it("applyCurrency switches the active currency/locale", () => {
    applyCurrency("USD");
    expect(["$", "US$"].some((s) => A$(5).includes(s))).toBe(true);
  });
});
