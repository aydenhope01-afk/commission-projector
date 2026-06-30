import { useRef, useState } from "react";
import { supabase } from "./supabaseClient";

const ICON_SRC = "/ft-icon.png";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_DOMAIN = "freighttasker.com";

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Jost:wght@300;400;500;600;700;800&display=swap');
.lgx-root{
  --navy:#1c3857; --navy-d:#13283f; --blue:#009bd6; --grn:#72c481;
  --hairline:#d8e0e8; --hairline-faint:#eef2f6; --label:#8595a5; --text-2:#64778a;
  --on-navy-label:#7fa8c9; --on-navy-muted:#9fbdd6; --on-navy-track:#2f4c6e;
  --amber:#d98a2b; --amber-bg:#fcf2e4;
  --fb:'Jost',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  font-family:var(--fb); color:var(--navy); -webkit-font-smoothing:antialiased;
}
.lgx-root *{box-sizing:border-box;}
.lgx-root input::placeholder{color:#9aa9b8;}
.lgx-grid{min-height:100vh;display:grid;grid-template-columns:1.05fr .95fr;background:#fafbfc;}

/* ── left: navy instrument ── */
.lgx-left{background:var(--navy);color:#fff;position:relative;overflow:hidden;display:flex;flex-direction:column;justify-content:space-between;padding:48px 56px;}
.lgx-watermark{position:absolute;right:-130px;top:-120px;width:460px;height:460px;filter:brightness(0) invert(1);opacity:.05;pointer-events:none;}
.lgx-logo{display:flex;align-items:center;gap:11px;position:relative;z-index:1;}
.lgx-logo span{font-size:23px;font-weight:700;letter-spacing:-.01em;}
.lgx-logo img{width:31px;height:31px;display:block;filter:brightness(0) invert(1);}
.lgx-center{position:relative;z-index:1;margin:auto 0;}
.lgx-eyebrow{font-size:12px;font-weight:600;letter-spacing:.16em;color:var(--on-navy-label);margin-bottom:22px;}
.lgx-gauge{position:relative;width:300px;height:201px;margin-bottom:30px;}
.lgx-gauge svg{display:block;}
.lgx-gauge-mark{position:absolute;left:150px;top:160px;transform:translate(-50%,-50%);width:34px;height:34px;filter:brightness(0) invert(1);opacity:.95;}
.lgx-headline{font-size:40px;font-weight:800;letter-spacing:-.025em;line-height:1.05;margin-bottom:16px;max-width:14ch;}
.lgx-sub{font-size:15px;color:var(--on-navy-muted);line-height:1.55;max-width:42ch;}

/* ── right: sign-in document ── */
.lgx-right{display:flex;align-items:center;justify-content:center;padding:48px;}
.lgx-doc{width:404px;max-width:100%;}
.lgx-tab{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--navy);border-bottom:none;border-radius:3px 3px 0 0;background:var(--navy);color:#fff;padding:8px 16px;}
.lgx-tab-dot{width:7px;height:7px;border-radius:50%;background:var(--grn);}
.lgx-tab span{font-size:11px;font-weight:700;letter-spacing:.12em;}
.lgx-frame{border:1px solid var(--navy);border-radius:0 3px 3px 3px;background:#fff;padding:34px 34px 30px;}
.lgx-frame-eyebrow{font-size:12px;font-weight:600;letter-spacing:.16em;color:var(--blue);margin-bottom:8px;}
.lgx-h2{font-size:30px;font-weight:800;color:var(--navy);letter-spacing:-.02em;margin:0 0 8px;}
.lgx-intro{font-size:14px;color:var(--text-2);line-height:1.5;margin:0 0 26px;}
.lgx-label{display:block;font-size:11px;font-weight:600;letter-spacing:.14em;color:var(--label);margin-bottom:8px;}
.lgx-field{display:flex;align-items:center;border:1px solid var(--hairline);border-radius:2px;background:#fff;padding:0 14px;height:50px;transition:border-color .15s ease,box-shadow .15s ease;}
.lgx-field:focus-within{border-color:var(--blue);box-shadow:0 0 0 3px rgba(0,155,214,.15);}
.lgx-field:focus-within .lgx-field-icon{stroke:var(--navy);}
.lgx-field.invalid{border-color:var(--amber);}
.lgx-field-icon{flex-shrink:0;transition:stroke .15s ease;}
.lgx-field input{flex:1;border:none;outline:none;font-size:15px;color:var(--navy);padding:0 0 0 11px;height:100%;background:transparent;font-family:var(--fb);}
.lgx-help{margin:8px 0 0;font-size:12px;line-height:1.4;}
.lgx-help.amber{color:var(--amber);}
.lgx-field-wrap{margin-bottom:22px;}
.lgx-btn{width:100%;height:50px;border:1px solid var(--navy);border-radius:2px;background:var(--navy);color:#fff;font-size:15px;font-weight:700;letter-spacing:.01em;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:9px;transition:background .15s ease;}
.lgx-btn:hover:not(:disabled){background:var(--navy-d);}
.lgx-btn:disabled{opacity:.65;cursor:default;}
.lgx-btn:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(0,155,214,.45);}
.lgx-spin{width:16px;height:16px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:lgx-rot .7s linear infinite;}
@keyframes lgx-rot{to{transform:rotate(360deg);}}
.lgx-errbox{display:flex;align-items:flex-start;gap:9px;margin-top:16px;padding:11px 13px;background:var(--amber-bg);border:1px solid var(--amber);border-radius:2px;}
.lgx-errbox span{font-size:12.5px;color:var(--amber);line-height:1.45;font-weight:500;}
.lgx-note{display:flex;align-items:center;gap:9px;margin-top:18px;padding-top:18px;border-top:1px solid var(--hairline-faint);}
.lgx-note span{font-size:12.5px;color:var(--text-2);line-height:1.4;}
.lgx-below{font-size:12.5px;color:var(--label);text-align:center;margin:22px 0 0;line-height:1.5;}
.lgx-below button{font-family:var(--fb);background:none;border:0;padding:0;color:var(--blue);font-weight:600;font-size:12.5px;cursor:pointer;}
.lgx-below button:hover{text-decoration:underline;}

/* ── sent / confirmation ── */
.lgx-sent{text-align:center;}
.lgx-sent-mark{width:64px;height:64px;margin:4px auto 18px;}
.lgx-sent h2{font-size:24px;font-weight:800;color:var(--navy);letter-spacing:-.02em;margin:0 0 10px;}
.lgx-sent p{font-size:14px;color:var(--text-2);line-height:1.55;margin:0 auto 22px;max-width:34ch;}
.lgx-sent-actions{display:flex;flex-direction:column;gap:12px;align-items:center;}
.lgx-link{font-family:var(--fb);background:none;border:0;padding:2px 4px;font-size:14px;font-weight:600;cursor:pointer;}
.lgx-link.azure{color:var(--blue);}
.lgx-link.navy{color:var(--navy);}
.lgx-link:hover{text-decoration:underline;}
.lgx-link:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(0,155,214,.35);border-radius:2px;}

@media (prefers-reduced-motion: reduce){
  .lgx-spin{animation:none;}
  .lgx-field,.lgx-btn,.lgx-field-icon{transition:none;}
}

/* ── responsive: stack to single column ── */
@media (max-width:860px){
  .lgx-grid{grid-template-columns:1fr;}
  .lgx-left{padding:26px 28px 30px;}
  .lgx-center{margin:16px 0 0;}
  .lgx-eyebrow,.lgx-gauge,.lgx-sub{display:none;}
  .lgx-headline{font-size:24px;max-width:none;margin-bottom:0;}
  .lgx-watermark{width:300px;right:-90px;top:-90px;}
  .lgx-right{padding:32px 20px;}
}
`;

export default function Login() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const [fieldError, setFieldError] = useState("");
  const inputRef = useRef(null);

  async function sendLink() {
    setStatus("sending");
    // Send the trimmed address — onSubmit validates email.trim(), so without this
    // surrounding whitespace would be sent to signInWithOtp (and shown as "sent to").
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setStatus(error ? "error" : "sent");
  }

  // NOTE: the domain check below is for fast UX feedback only. Real enforcement
  // is the enforce_email_domain trigger on auth.users in supabase/setup.sql —
  // without that trigger this check is bypassable by calling
  // supabase.auth.signInWithOtp() directly. Keep ALLOWED_DOMAIN and the SQL
  // allowlist in sync.
  function onSubmit(e) {
    e.preventDefault();
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setFieldError("Enter a valid work email.");
      inputRef.current?.focus();
      return;
    }
    if (value.split("@")[1].toLowerCase() !== ALLOWED_DOMAIN) {
      setFieldError(`Access is limited to @${ALLOWED_DOMAIN} email addresses.`);
      inputRef.current?.focus();
      return;
    }
    setFieldError("");
    if (value !== email) setEmail(value); // normalize so the "sent to" line is clean
    sendLink();
  }

  function useDifferentEmail() {
    setStatus("idle");
    setEmail("");
    setFieldError("");
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  return (
    <div className="lgx-root">
      <style>{CSS}</style>
      <div className="lgx-grid">

        {/* ── left: navy instrument ── */}
        <aside className="lgx-left">
          <img className="lgx-watermark" src={ICON_SRC} alt="" aria-hidden="true" />

          <div className="lgx-logo">
            <span>Freight</span>
            <img src={ICON_SRC} alt="Freight Tasker" />
            <span>Tasker</span>
          </div>

          <div className="lgx-center">
            <div className="lgx-eyebrow">SALES COMMISSION MANIFEST</div>
            <div className="lgx-gauge">
              <svg width="300" height="201" viewBox="0 0 280 188" aria-hidden="true">
                <path d="M20,150 A120,120 0 0 1 260,150" fill="none" stroke="#2f4c6e" strokeWidth="14" strokeLinecap="round" />
                <path d="M20,150 A120,120 0 0 1 124.6,31.7" fill="none" stroke="#009bd6" strokeWidth="14" strokeLinecap="round" />
                <line x1="140" y1="150" x2="124.6" y2="31.7" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
                <circle cx="124.6" cy="31.7" r="6" fill="#fff" />
                <circle cx="140" cy="150" r="30" fill="#1c3857" stroke="#009bd6" strokeWidth="2.5" />
              </svg>
              <img className="lgx-gauge-mark" src={ICON_SRC} alt="" aria-hidden="true" />
            </div>
            <h1 className="lgx-headline">Chart your course to the commission line.</h1>
            <p className="lgx-sub">Project qualifying GP, track every account, and see exactly how far you are from threshold — in one operational view.</p>
          </div>
        </aside>

        {/* ── right: sign-in document ── */}
        <main className="lgx-right">
          <div className="lgx-doc">
            <div className="lgx-tab">
              <span className="lgx-tab-dot" />
              <span>CREW ACCESS</span>
            </div>

            <div className="lgx-frame">
              {status === "sent" ? (
                <div className="lgx-sent">
                  <div className="lgx-sent-mark">
                    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true">
                      <circle cx="32" cy="32" r="29" stroke="#72c481" strokeWidth="2.5" />
                      <path d="M21 33l7.5 7.5L43 26" stroke="#72c481" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <h2>Check your inbox</h2>
                  <p>We sent a magic link to <b>{email}</b>. It expires in 15 minutes.</p>
                  <div className="lgx-sent-actions">
                    <button type="button" className="lgx-link azure" onClick={sendLink}>Resend link</button>
                    <button type="button" className="lgx-link navy" onClick={useDifferentEmail}>Use a different email</button>
                  </div>
                </div>
              ) : (
                <form onSubmit={onSubmit} noValidate>
                  <div className="lgx-frame-eyebrow">COMMISSION PROJECTOR</div>
                  <h2 className="lgx-h2">Sign in</h2>
                  <p className="lgx-intro">Enter your work email and we'll send a secure magic link to access your projections — no password to remember.</p>

                  <div className="lgx-field-wrap">
                    <label className="lgx-label" htmlFor="lgx-email">WORK EMAIL</label>
                    <div className={"lgx-field" + (fieldError ? " invalid" : "")}>
                      <svg className="lgx-field-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#8595a5" strokeWidth="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="1" /><path d="m3 7 9 6 9-6" /></svg>
                      <input
                        id="lgx-email"
                        ref={inputRef}
                        type="email"
                        autoComplete="email"
                        placeholder="you@freighttasker.com"
                        aria-invalid={!!fieldError}
                        aria-describedby={fieldError ? "lgx-email-err" : undefined}
                        value={email}
                        onChange={(e) => { setEmail(e.target.value); if (fieldError) setFieldError(""); }}
                      />
                    </div>
                    {fieldError && <p className="lgx-help amber" id="lgx-email-err">{fieldError}</p>}
                  </div>

                  <button className="lgx-btn" type="submit" disabled={status === "sending"}>
                    {status === "sending" ? (
                      <><span className="lgx-spin" aria-hidden="true" />Sending link…</>
                    ) : (
                      <>Send me a magic link
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#72c481" strokeWidth="2.5" aria-hidden="true"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
                      </>
                    )}
                  </button>

                  {status === "error" && (
                    <div className="lgx-errbox" role="alert">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#d98a2b" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true"><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
                      <span>Couldn't send the link — try again.</span>
                    </div>
                  )}

                  <div className="lgx-note">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#72c481" strokeWidth="2" style={{ flexShrink: 0 }} aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="1" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
                    <span>Links expire in 15 minutes and can only be used once.</span>
                  </div>
                </form>
              )}
            </div>

            <p className="lgx-below">Trouble signing in? <button type="button">Contact your administrator</button></p>
          </div>
        </main>

      </div>
    </div>
  );
}
