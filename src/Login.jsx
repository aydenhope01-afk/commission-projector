import { useState } from "react";
import { supabase } from "./supabaseClient";

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@600;700;800&family=Jost:wght@400;500;600;700&display=swap');
.lg-root{
  --navy:#1C3857; --navy-d:#13283F; --grn:#72C481; --grn-d:#479A5C;
  --ink:#1C3857; --muted:#6E7E92; --line:#E2E7EC; --paper:#F4F7F9; --card:#FFFFFF;
  --fh:'Poppins',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  --fb:'Jost',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
  font-family:var(--fb); background:var(--paper); color:var(--ink);
  min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px;
}
.lg-root *{box-sizing:border-box;}
.lg-card{background:var(--card); border:1px solid var(--line); border-radius:16px; padding:32px; width:100%; max-width:380px; box-shadow:0 8px 30px rgba(28,56,87,.07);}
.lg-word{font-family:var(--fh); font-weight:700; font-size:23px; color:#0E1E3D; letter-spacing:-.01em;}
.lg-title{font-family:var(--fh); font-weight:700; font-size:20px; margin:18px 0 4px;}
.lg-sub{font-family:var(--fb); font-size:13px; color:var(--muted); margin:0 0 20px;}
.lg-input{width:100%; font-family:var(--fb); font-size:14px; padding:11px 13px; border:1px solid var(--line); border-radius:9px; outline:none; margin-bottom:12px;}
.lg-input:focus{border-color:var(--navy);}
.lg-btn{width:100%; font-family:var(--fb); background:var(--navy); color:#fff; border:0; border-radius:9px; padding:11px 15px; font-size:14px; font-weight:600; cursor:pointer;}
.lg-btn:hover{background:var(--navy-d);}
.lg-btn:disabled{opacity:.6; cursor:default;}
.lg-msg{font-family:var(--fb); font-size:13px; font-weight:600; color:var(--grn-d); margin:14px 0 0;}
.lg-err{font-family:var(--fb); font-size:13px; font-weight:600; color:#C0392B; margin:14px 0 0;}
`;

export default function Login() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const [error, setError] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    if (!email) return;
    setStatus("sending");
    setError("");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      setError(error.message);
      setStatus("error");
    } else {
      setStatus("sent");
    }
  }

  return (
    <div className="lg-root">
      <style>{CSS}</style>
      <div className="lg-card">
        <span className="lg-word">Freight Tasker</span>
        <h1 className="lg-title">Commission Projector</h1>
        <p className="lg-sub">Sign in with a magic link to access your projections.</p>

        {status === "sent" ? (
          <p className="lg-msg">Check your email for the link.</p>
        ) : (
          <form onSubmit={onSubmit}>
            <input
              className="lg-input"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button className="lg-btn" type="submit" disabled={status === "sending"}>
              {status === "sending" ? "Sending…" : "Send me a link"}
            </button>
            {status === "error" && <p className="lg-err">{error}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
