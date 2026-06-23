import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "./supabaseClient";

/* ───────────────────────── constants ───────────────────────── */
const STORAGE_KEY = "ft_commission_v2";
const LOGO_SRC = "data:image/png;base64,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";

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

const A$ = (n) => "$" + Math.round(n || 0).toLocaleString("en-AU", { maximumFractionDigits: 0 });
const A$2 = (n) =>
  "$" + (n || 0).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ───────────────────────── persistence ───────────────────────── */
async function loadState() {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) return null;
  const { data, error } = await supabase
    .from("projector_state")
    .select("data")
    .eq("user_id", u.user.id)
    .maybeSingle();
  if (error || !data) return null;
  return data.data; // -> { accounts, settings, proj }
}
async function saveState(state) {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) return false;
  const { error } = await supabase
    .from("projector_state")
    .upsert({ user_id: u.user.id, data: state, updated_at: new Date().toISOString() });
  return !error;
}

const DEFAULT_SETTINGS = { base: 70000, car: 15000, multiplier: 2.5, rate: 10 };
const DEFAULT_PROJ = { retention: 85, years: 5, newPerYear: null, payRise: 0 };
const seedAccounts = () => [
  { id: uid(), name: "Weekly China importer", lines: [{ id: uid(), type: "FCL", freq: "weekly", profit: 500 }] },
  { id: uid(), name: "Machinery client", lines: [{ id: uid(), type: "RORO", freq: "monthly", profit: 1500 }] },
];

/* ───────────────────────── brand mark ───────────────────────── */
function Logo() {
  return (
    <div className="ft-logo">
      <span className="ft-word">Freight</span>
      <img className="ft-logo-img" src={LOGO_SRC} alt="Freight Tasker" />
      <span className="ft-word">Tasker</span>
    </div>
  );
}

/* ───────────────────────── component ───────────────────────── */
export default function CommissionProjector() {
  const [tab, setTab] = useState("year");
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [accounts, setAccounts] = useState(seedAccounts);
  const [proj, setProj] = useState(DEFAULT_PROJ);
  const [loaded, setLoaded] = useState(false);
  const [persisted, setPersisted] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    loadState().then((s) => {
      if (s && s.accounts) {
        setAccounts(s.accounts);
        setSettings({ ...DEFAULT_SETTINGS, ...(s.settings || {}) });
        setProj({ ...DEFAULT_PROJ, ...(s.proj || {}) });
      }
      setLoaded(true);
    });
  }, []);
  useEffect(() => {
    if (!loaded) return;
    saveState({ accounts, settings, proj }).then((ok) => setPersisted(ok));
  }, [accounts, settings, proj, loaded]);

  const calc = useMemo(() => {
    const pkg = (Number(settings.base) || 0) + (Number(settings.car) || 0);
    const threshold = pkg * (Number(settings.multiplier) || 0);
    const rate = (Number(settings.rate) || 0) / 100;
    const byType = { FCL: 0, LCL: 0, AIR: 0, RORO: 0 };
    let totalGP = 0;
    const accTotals = {};
    for (const acc of accounts) {
      let at = 0;
      for (const ln of acc.lines) {
        const ann = (Number(ln.profit) || 0) * (FREQ_MULT[ln.freq] || 0);
        at += ann;
        byType[ln.type] = (byType[ln.type] || 0) + ann;
      }
      accTotals[acc.id] = at;
      totalGP += at;
    }
    const over = Math.max(0, totalGP - threshold);
    const commission = over * rate;
    const gap = Math.max(0, threshold - totalGP);
    const quarters = [];
    let prevComm = 0;
    for (let q = 1; q <= 4; q++) {
      const cumGP = totalGP * (q / 4);
      const cumComm = Math.max(0, cumGP - threshold) * rate;
      quarters.push({ q, cumGP, payment: cumComm - prevComm });
      prevComm = cumComm;
    }
    return { pkg, threshold, rate, totalGP, over, commission, gap, byType, accTotals, total: pkg + commission, quarters };
  }, [accounts, settings]);

  const projection = useMemo(() => {
    const rate = (Number(settings.rate) || 0) / 100;
    const mult = Number(settings.multiplier) || 0;
    const basePkg = calc.pkg;
    const newPY = proj.newPerYear == null ? calc.totalGP : Number(proj.newPerYear) || 0;
    const ret = (Number(proj.retention) || 0) / 100;
    const years = Number(proj.years) || 1;
    const rows = [];
    let prevTotal = 0;
    let cumComm = 0;
    for (let y = 1; y <= years; y++) {
      const pkg = basePkg + (Number(proj.payRise) || 0) * (y - 1);
      const threshold = pkg * mult;
      const carried = y === 1 ? 0 : prevTotal * ret;
      const newGP = y === 1 ? calc.totalGP : newPY;
      const total = carried + newGP;
      const commission = Math.max(0, total - threshold) * rate;
      cumComm += commission;
      rows.push({ y, pkg, threshold, carried, newGP, total, commission, earnings: pkg + commission, cumComm });
      prevTotal = total;
    }
    const max = Math.max(...rows.map((r) => Math.max(r.total, r.threshold)), 1);
    return { rows, cumComm, max, newPY };
  }, [calc.totalGP, calc.pkg, settings, proj]);

  const addAccount = () =>
    setAccounts((a) => [...a, { id: uid(), name: "New account", lines: [{ id: uid(), type: "FCL", freq: "weekly", profit: TYPE_DEFAULTS.FCL }] }]);
  const removeAccount = (id) => setAccounts((a) => a.filter((x) => x.id !== id));
  const renameAccount = (id, name) => setAccounts((a) => a.map((x) => (x.id === id ? { ...x, name } : x)));
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
  const resetAll = () => {
    if (typeof window === "undefined" || !window.confirm || window.confirm("Clear all accounts and reset settings?")) {
      setAccounts([]); setSettings(DEFAULT_SETTINGS); setProj(DEFAULT_PROJ);
    }
  };

  const fcLboxes = Math.ceil(calc.gap / (TYPE_DEFAULTS.FCL * 52)) || 0;
  const roroUnits = Math.ceil(calc.gap / (TYPE_DEFAULTS.RORO * 12)) || 0;
  const lastRow = projection.rows[projection.rows.length - 1] || { total: 0, commission: 0 };

  return (
    <div className="cp-root">
      <style>{CSS}</style>

      <header className="cp-header">
        <Logo />
        <div className="cp-head-actions">
          <span className={"cp-save " + (persisted ? "ok" : "off")}>
            {persisted == null ? "" : persisted ? "● Saved" : "Session only"}
          </span>
          <button className="cp-gear" onClick={() => setShowSettings((s) => !s)}>{showSettings ? "Close settings" : "Settings"}</button>
          <button className="cp-gear" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>

      <div className="cp-titleblock">
        <div className="cp-eyebrow">Sales commission · Ayden Hope</div>
        <h1 className="cp-title">Commission Projector</h1>
      </div>

      <nav className="cp-tabs">
        <button className={tab === "year" ? "on" : ""} onClick={() => setTab("year")}>This year</button>
        <button className={tab === "multi" ? "on" : ""} onClick={() => setTab("multi")}>Multi-year forecast</button>
      </nav>

      {showSettings && (
        <section className="cp-settings">
          <Field label="Base salary"><Money value={settings.base} onChange={(v) => setSettings((s) => ({ ...s, base: v }))} /></Field>
          <Field label="Car allowance"><Money value={settings.car} onChange={(v) => setSettings((s) => ({ ...s, car: v }))} /></Field>
          <Field label="Threshold multiplier"><input className="cp-input" type="number" step="0.1" value={settings.multiplier} onChange={(e) => setSettings((s) => ({ ...s, multiplier: Number(e.target.value) }))} /></Field>
          <Field label="Commission rate %"><input className="cp-input" type="number" step="0.5" value={settings.rate} onChange={(e) => setSettings((s) => ({ ...s, rate: Number(e.target.value) }))} /></Field>
          <div className="cp-settings-note">
            Package <b>{A$(calc.pkg)}</b> × {settings.multiplier} = <b>{A$(calc.threshold)}</b> threshold · {settings.rate}% on every dollar over.
            <button className="cp-reset" onClick={resetAll}>Reset all</button>
          </div>
        </section>
      )}

      {/* ════════════ TAB 1 ════════════ */}
      {tab === "year" && (
        <>
          <section className="cp-stats">
            <Stat label="Qualifying GP" value={A$(calc.totalGP)} />
            <Stat label="Threshold (2.5×)" value={A$(calc.threshold)} sub="package" />
            <Stat label="Projected commission" value={A$(calc.commission)} accent sub={calc.over > 0 ? A$(calc.over) + " over line" : "below line"} />
            <Stat label="Total earnings" value={A$(calc.total)} sub="package + commission" />
          </section>

          <section className="cp-track-wrap">
            <Track threshold={calc.threshold} total={calc.totalGP} />
            <div className="cp-track-caption">
              {calc.gap > 0 ? (
                <><b>{A$(calc.gap)}</b> to the commission line — about <b>{fcLboxes}</b> more weekly FCL {fcLboxes === 1 ? "box" : "boxes"} or <b>{roroUnits}</b> monthly RORO {roroUnits === 1 ? "unit" : "units"}.</>
              ) : (
                <><b>{A$(calc.over)}</b> over the line, earning <b className="pos">{A$(calc.commission)}</b> at {settings.rate}%.</>
              )}
            </div>
          </section>

          <div className="cp-grid">
            <section className="cp-accounts">
              <div className="cp-section-head">
                <h2>Accounts</h2>
                <button className="cp-add" onClick={addAccount}>+ Add account</button>
              </div>
              {accounts.length === 0 && (
                <div className="cp-empty">No accounts yet. Add your first win to start projecting.<button className="cp-add big" onClick={addAccount}>+ Add account</button></div>
              )}
              {accounts.map((acc) => (
                <div className="cp-card" key={acc.id}>
                  <div className="cp-card-top">
                    <input className="cp-acc-name" value={acc.name} onChange={(e) => renameAccount(acc.id, e.target.value)} />
                    <div className="cp-acc-total">{A$(calc.accTotals[acc.id])}<span>/yr</span></div>
                    <button className="cp-x" title="Remove account" onClick={() => removeAccount(acc.id)}>×</button>
                  </div>
                  <div className="cp-lines">
                    {acc.lines.map((ln) => {
                      const ann = (Number(ln.profit) || 0) * (FREQ_MULT[ln.freq] || 0);
                      return (
                        <div className="cp-line" key={ln.id}>
                          <span className="cp-dot" style={{ background: TYPE_COLOR[ln.type] }} />
                          <select className="cp-sel type" value={ln.type} onChange={(e) => updateLine(acc.id, ln.id, { type: e.target.value })}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
                          <select className="cp-sel" value={ln.freq} onChange={(e) => updateLine(acc.id, ln.id, { freq: e.target.value })}>{FREQS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select>
                          <div className="cp-money-in"><span>$</span><input type="number" value={ln.profit} onChange={(e) => updateLine(acc.id, ln.id, { profit: Number(e.target.value) })} /><em>/shpt</em></div>
                          <div className="cp-line-ann">{A$(ann)}<span>/yr</span>{ln.freq === "one-off" && <i className="cp-tag">one-off</i>}</div>
                          <button className="cp-x sm" onClick={() => removeLine(acc.id, ln.id)}>×</button>
                        </div>
                      );
                    })}
                  </div>
                  <button className="cp-add-line" onClick={() => addLine(acc.id)}>+ freight line</button>
                </div>
              ))}
            </section>

            <aside className="cp-rail">
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
                <table className="cp-qtable">
                  <thead><tr><th>Qtr</th><th>Cumulative GP</th><th>Payment</th></tr></thead>
                  <tbody>
                    {calc.quarters.map((q) => (
                      <tr key={q.q} className={q.payment > 0 ? "live" : ""}>
                        <td>Q{q.q}</td><td>{A$(q.cumGP)}</td>
                        <td className={q.payment > 0 ? "pos" : "muted"}>{q.payment > 0 ? A$2(q.payment) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="cp-foot">Assumes even GP across the year. Each payment lands ~6 weeks after the quarter closes, on accounts within payment terms.</p>
              </div>
            </aside>
          </div>
        </>
      )}

      {/* ════════════ TAB 2 ════════════ */}
      {tab === "multi" && (
        <>
          <section className="cp-proj-controls">
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
              <p className="cp-ret-note">Share of each year's book that rolls into the next. Year 1 is your current book ({A$(calc.totalGP)}).</p>
            </div>

            <div className="cp-proj-fields">
              <Field label="New GP won per year">
                <div className="cp-money-in wide">
                  <span>$</span>
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
            </div>
          </section>

          <section className="cp-stats three">
            <Stat label={`Year ${proj.years} GP`} value={A$(lastRow.total)} sub="rolled-up book" />
            <Stat label={`Year ${proj.years} commission`} value={A$(lastRow.commission)} />
            <Stat label={`${proj.years}-year commission`} value={A$(projection.cumComm)} accent sub="cumulative" />
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
            <h3>Year-by-year</h3>
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
            <p className="cp-foot">Year 1 = your current book. Each later year carries the prior book forward at {proj.retention}% retention and adds {A$(projection.newPY)} of new GP. Threshold grows with any pay rise. Commission is {settings.rate}% on every dollar over that year's threshold.</p>
          </section>
        </>
      )}

      <footer className="cp-footer">
        <img className="ft-foot-img" src={LOGO_SRC} alt="Freight Tasker" />
        <span>Connecting ideas, people, goods and opportunity</span>
      </footer>
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
  return (<div className="cp-money-in wide"><span>$</span><input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} /></div>);
}
function Track({ threshold, total }) {
  const scaleMax = Math.max(total, threshold) * 1.08 || 1;
  const thrPct = (threshold / scaleMax) * 100;
  const navyPct = (Math.min(total, threshold) / scaleMax) * 100;
  const grnPct = (Math.max(0, total - threshold) / scaleMax) * 100;
  return (
    <div className="cp-track">
      <div className="cp-track-bar">
        <div className="cp-fill navy" style={{ width: navyPct + "%" }} />
        <div className="cp-fill grn" style={{ left: thrPct + "%", width: grnPct + "%" }} />
        <div className="cp-thr" style={{ left: thrPct + "%" }}><span className="cp-thr-flag">{A$(threshold)}</span></div>
      </div>
      <div className="cp-track-scale"><span>$0</span><span className="right">{A$(scaleMax)}</span></div>
    </div>
  );
}

/* ───────────────────────── styles ───────────────────────── */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@600;700;800&family=Jost:wght@400;500;600;700&display=swap');
.cp-root{
  --navy:#1C3857; --navy-d:#13283F; --blue:#009BD6; --blue-d:#0480B0;
  --grn:#72C481; --grn-d:#479A5C;
  --ink:#1C3857; --muted:#6E7E92; --line:#E2E7EC; --paper:#F4F7F9; --card:#FFFFFF;
  --fh:'Poppins',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  --fb:'Jost',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  font-family:var(--fb); background:var(--paper); color:var(--ink);
  padding:24px; max-width:1060px; margin:0 auto; font-variant-numeric:tabular-nums;
}
.cp-root *{box-sizing:border-box;}

.ft-logo{display:flex;align-items:center;gap:9px;}
.ft-word{font-family:var(--fh);font-weight:700;font-size:23px;color:#0E1E3D;letter-spacing:-.01em;}
.ft-mark{display:block;}
.ft-logo-img{display:block;height:34px;width:34px;}
.ft-foot-img{display:block;height:18px;width:18px;opacity:.55;}

.cp-header{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;}
.cp-head-actions{display:flex;align-items:center;gap:12px;}
.cp-save{font-family:var(--fb);font-size:11px;font-weight:600;letter-spacing:.04em;}
.cp-save.ok{color:var(--grn-d);} .cp-save.off{color:var(--muted);}
.cp-gear{font-family:var(--fb);background:var(--navy);color:#fff;border:0;border-radius:9px;padding:9px 15px;font-size:13px;font-weight:600;cursor:pointer;}
.cp-gear:hover{background:var(--navy-d);}

.cp-titleblock{margin-top:18px;}
.cp-eyebrow{font-family:var(--fb);font-size:11px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--blue);}
.cp-title{font-family:var(--fh);font-size:30px;font-weight:800;letter-spacing:-.02em;margin:4px 0 0;color:var(--navy);}

.cp-tabs{display:flex;gap:4px;margin-top:16px;background:#E5ECF1;padding:4px;border-radius:11px;width:fit-content;}
.cp-tabs button{font-family:var(--fb);border:0;background:none;padding:9px 18px;font-size:13.5px;font-weight:600;color:var(--muted);border-radius:8px;cursor:pointer;}
.cp-tabs button.on{background:#fff;color:var(--navy);box-shadow:0 1px 4px rgba(28,56,87,.14);}

.cp-settings{margin-top:16px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;display:grid;grid-template-columns:repeat(4,1fr);gap:14px;align-items:end;}
.cp-settings-note{grid-column:1/-1;font-size:13px;color:var(--muted);border-top:1px solid var(--line);padding-top:12px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;}
.cp-settings-note b{color:var(--ink);font-weight:700;}
.cp-reset{font-family:var(--fb);margin-left:auto;background:none;border:1px solid var(--line);color:var(--muted);border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;}
.cp-reset:hover{border-color:#d9534f;color:#d9534f;}
.cp-field{display:flex;flex-direction:column;gap:6px;font-family:var(--fb);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);}
.cp-input{font-family:var(--fb);border:1px solid var(--line);border-radius:9px;padding:10px;font-size:15px;font-weight:600;color:var(--ink);background:#fff;font-variant-numeric:tabular-nums;}

.cp-stats{margin-top:18px;display:grid;grid-template-columns:repeat(4,1fr);gap:13px;}
.cp-stats.three{grid-template-columns:repeat(3,1fr);}
.cp-stat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 17px;}
.cp-stat.accent{position:relative;overflow:hidden;background:linear-gradient(155deg,#274769,#1C3857);border-color:var(--navy);}
.cp-stat.accent::after{content:"";position:absolute;right:-26px;bottom:-26px;width:118px;height:118px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='46' fill='none' stroke='%23ffffff' stroke-opacity='0.12' stroke-width='3'/%3E%3Cpath fill='%23ffffff' fill-opacity='0.12' fill-rule='evenodd' d='M50 12 L59.2 40.8 L88 50 L59.2 59.2 L50 88 L40.8 59.2 L12 50 L40.8 40.8 Z M43 50 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0 Z'/%3E%3C/svg%3E");background-size:contain;}
.cp-stat-label{font-family:var(--fb);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);}
.cp-stat.accent .cp-stat-label{color:#A7C0D6;}
.cp-stat-value{font-family:var(--fh);font-size:26px;font-weight:800;letter-spacing:-.02em;margin-top:6px;color:var(--navy);}
.cp-stat.accent .cp-stat-value{color:var(--grn);}
.cp-stat-sub{font-size:12px;color:var(--muted);margin-top:3px;font-weight:500;}
.cp-stat.accent .cp-stat-sub{color:#8FA8C0;}

.cp-track-wrap{margin-top:14px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px 18px 14px;}
.cp-track-bar{position:relative;height:30px;background:#E5ECF1;border-radius:8px;}
.cp-fill{position:absolute;top:0;height:100%;}
.cp-fill.navy{left:0;background:linear-gradient(90deg,#2C5079,#1C3857);border-radius:8px 0 0 8px;}
.cp-fill.grn{background:linear-gradient(90deg,var(--grn),var(--grn-d));border-radius:0 8px 8px 0;}
.cp-thr{position:absolute;top:-6px;bottom:-6px;width:2px;background:var(--navy-d);}
.cp-thr-flag{font-family:var(--fb);position:absolute;top:-20px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:11px;font-weight:700;color:var(--navy-d);}
.cp-track-scale{display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-top:8px;font-weight:600;}
.cp-track-caption{margin-top:13px;font-size:14px;color:var(--ink);font-weight:500;}
.cp-track-caption b{color:var(--navy);font-weight:700;} .cp-track-caption .pos,.pos{color:var(--grn-d);}

.cp-grid{margin-top:16px;display:grid;grid-template-columns:1.55fr 1fr;gap:16px;align-items:start;}
.cp-section-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:11px;}
.cp-section-head h2{font-family:var(--fh);font-size:15px;font-weight:700;letter-spacing:.01em;color:var(--navy);margin:0;text-transform:uppercase;}
.cp-add{font-family:var(--fb);background:var(--grn);color:var(--navy-d);border:0;border-radius:9px;padding:9px 14px;font-size:13px;font-weight:700;cursor:pointer;}
.cp-add:hover{background:var(--grn-d);color:#fff;}
.cp-add.big{display:block;margin:12px auto 0;}

.cp-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px;}
.cp-card-top{display:flex;align-items:center;gap:10px;}
.cp-acc-name{font-family:var(--fh);flex:1;border:0;border-bottom:1.5px solid transparent;font-size:16px;font-weight:700;color:var(--navy);padding:3px 2px;background:none;}
.cp-acc-name:focus{outline:none;border-bottom-color:var(--blue);}
.cp-acc-total{font-family:var(--fh);font-size:16px;font-weight:800;color:var(--navy);}
.cp-acc-total span,.cp-line-ann span{font-family:var(--fb);font-size:11px;font-weight:500;color:var(--muted);margin-left:2px;}
.cp-x{background:none;border:0;color:var(--muted);font-size:20px;line-height:1;cursor:pointer;padding:0 4px;}
.cp-x:hover{color:#d9534f;} .cp-x.sm{font-size:16px;}
.cp-lines{margin-top:10px;display:flex;flex-direction:column;gap:7px;}
.cp-line{display:flex;align-items:center;gap:7px;}
.cp-dot{width:9px;height:9px;border-radius:50%;flex:none;}
.cp-sel{font-family:var(--fb);border:1px solid var(--line);border-radius:8px;padding:8px;font-size:13px;font-weight:500;color:var(--ink);background:#fff;}
.cp-sel.type{font-weight:700;color:var(--navy);width:74px;}
.cp-money-in{display:flex;align-items:center;border:1px solid var(--line);border-radius:8px;padding:0 8px;background:#fff;}
.cp-money-in span{color:var(--muted);font-size:13px;}
.cp-money-in input{font-family:var(--fb);border:0;width:62px;padding:8px 4px;font-size:13px;font-weight:600;color:var(--ink);font-variant-numeric:tabular-nums;background:none;}
.cp-money-in input:focus{outline:none;} .cp-money-in em{font-style:normal;font-size:10px;color:var(--muted);}
.cp-money-in.wide input{width:100%;} .cp-money-in.wide{flex:1;}
.cp-line-ann{font-family:var(--fh);margin-left:auto;font-size:14px;font-weight:800;color:var(--navy);display:flex;align-items:center;gap:6px;}
.cp-tag{font-family:var(--fb);font-style:normal;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;background:#DFF1E4;color:var(--grn-d);padding:2px 6px;border-radius:5px;}
.cp-add-line{font-family:var(--fb);margin-top:10px;background:none;border:1px dashed var(--line);color:var(--blue);border-radius:9px;padding:8px 12px;font-size:12px;font-weight:600;cursor:pointer;width:100%;}
.cp-add-line:hover{border-color:var(--blue);background:#F2FAFE;}
.cp-empty{background:var(--card);border:1px dashed var(--line);border-radius:14px;padding:28px;text-align:center;color:var(--muted);font-size:14px;}

.cp-rail{display:flex;flex-direction:column;gap:16px;}
.cp-panel{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;}
.cp-panel.solo{margin-top:16px;}
.cp-panel h3{font-family:var(--fh);margin:0 0 12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--navy);}
.cp-mix{display:flex;flex-direction:column;gap:9px;}
.cp-mix-row{display:flex;align-items:center;gap:9px;}
.cp-mix-label{font-family:var(--fh);width:42px;font-size:12px;font-weight:700;color:var(--ink);}
.cp-mix-bar{flex:1;height:9px;background:#E9EEF3;border-radius:5px;overflow:hidden;}
.cp-mix-bar div{height:100%;border-radius:5px;transition:width .3s;}
.cp-mix-val{font-family:var(--fh);width:64px;text-align:right;font-size:12px;font-weight:700;color:var(--navy);}
.cp-qtable{width:100%;border-collapse:collapse;font-size:13px;}
.cp-qtable th{font-family:var(--fb);text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);padding:0 0 7px;font-weight:600;}
.cp-qtable th:last-child,.cp-qtable td:last-child{text-align:right;}
.cp-qtable td{padding:7px 0;border-top:1px solid var(--line);font-weight:600;}
.cp-qtable td.pos{color:var(--grn-d);font-weight:800;} .cp-qtable td.muted{color:var(--muted);}
.cp-qtable tr.live td:first-child{color:var(--navy);font-weight:800;}
.cp-foot{font-size:11px;color:var(--muted);margin:12px 0 0;line-height:1.55;font-weight:500;}

.cp-proj-controls{margin-top:18px;display:grid;grid-template-columns:1.1fr 1fr;gap:16px;align-items:stretch;}
.cp-ret{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:17px 19px;}
.cp-ret-head{display:flex;justify-content:space-between;align-items:baseline;}
.cp-ret-label{font-family:var(--fb);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);}
.cp-ret-val{font-family:var(--fh);font-size:32px;font-weight:800;color:var(--navy);letter-spacing:-.02em;}
.cp-range{width:100%;margin:9px 0 2px;accent-color:var(--blue);height:6px;}
.cp-chips{display:flex;gap:7px;margin-top:11px;}
.cp-chips button{font-family:var(--fb);flex:1;border:1px solid var(--line);background:#fff;color:var(--muted);border-radius:8px;padding:7px 0;font-size:12px;font-weight:600;cursor:pointer;}
.cp-chips button.on{background:var(--navy);color:#fff;border-color:var(--navy);}
.cp-ret-note{font-size:11.5px;color:var(--muted);margin:13px 0 0;line-height:1.55;font-weight:500;}
.cp-proj-fields{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:17px 19px;display:grid;grid-template-columns:1fr 1fr;gap:15px;align-content:start;}
.cp-mini{font-family:var(--fb);margin-top:6px;background:none;border:0;color:var(--blue);font-size:11px;font-weight:600;cursor:pointer;padding:0;text-align:left;text-transform:none;letter-spacing:0;}
.cp-mini:hover{color:var(--navy);}

.cp-chart-wrap{margin-top:16px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px 18px 15px;}
.cp-chart{display:flex;align-items:flex-end;gap:14px;height:210px;}
.cp-col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%;}
.cp-comm{font-family:var(--fh);text-align:center;font-size:12.5px;font-weight:800;color:var(--grn-d);height:18px;}
.cp-bar{position:relative;flex:1;display:flex;flex-direction:column-reverse;background:#EDF1F5;border-radius:7px 7px 0 0;min-height:4px;}
.cp-bar-carried{background:linear-gradient(180deg,#2C5079,#1C3857);width:100%;}
.cp-bar-new{background:linear-gradient(180deg,#3CB4E6,#009BD6);width:100%;border-radius:7px 7px 0 0;}
.cp-bar-thr{position:absolute;left:-3px;right:-3px;height:0;border-top:2px dashed var(--grn-d);z-index:3;}
.cp-bar-thr i{font-family:var(--fb);position:absolute;right:0;top:-15px;font-size:9px;font-weight:700;color:var(--grn-d);font-style:normal;background:var(--card);padding:0 3px;}
.cp-col-foot{text-align:center;margin-top:8px;display:flex;flex-direction:column;}
.cp-col-foot b{font-family:var(--fh);font-size:13px;color:var(--navy);font-weight:800;}
.cp-col-foot span{font-size:11px;color:var(--muted);font-weight:600;}
.cp-legend{display:flex;flex-wrap:wrap;gap:14px;margin-top:16px;border-top:1px solid var(--line);padding-top:13px;}
.cp-legend span{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--muted);font-weight:500;}
.cp-legend i{width:12px;height:12px;border-radius:3px;display:inline-block;}
.cp-legend i.line{height:0;border-top:2px dashed var(--grn-d);border-radius:0;}

.cp-ptable-wrap{overflow-x:auto;}
.cp-ptable{width:100%;border-collapse:collapse;font-size:13px;min-width:560px;}
.cp-ptable th{font-family:var(--fb);text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);padding:0 0 9px 10px;font-weight:600;}
.cp-ptable th:first-child,.cp-ptable td:first-child{text-align:left;padding-left:0;}
.cp-ptable td{padding:9px 0 9px 10px;border-top:1px solid var(--line);text-align:right;font-weight:600;}
.cp-ptable td.muted{color:var(--muted);} .cp-ptable td.pos{color:var(--grn-d);font-weight:800;}

.cp-footer{display:flex;align-items:center;justify-content:center;gap:9px;margin-top:26px;padding-top:18px;border-top:1px solid var(--line);font-size:12px;color:var(--muted);font-weight:500;letter-spacing:.01em;}

@media(max-width:820px){
  .cp-stats,.cp-settings{grid-template-columns:repeat(2,1fr);}
  .cp-stats.three{grid-template-columns:1fr;}
  .cp-grid,.cp-proj-controls{grid-template-columns:1fr;}
}
@media(max-width:520px){
  .cp-root{padding:15px;}
  .cp-stats{grid-template-columns:1fr 1fr;}
  .cp-line{flex-wrap:wrap;} .cp-line-ann{margin-left:0;}
  .cp-proj-fields{grid-template-columns:1fr;}
}
`;
