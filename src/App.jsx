import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import CommissionProjector from "./CommissionProjector";
import Login from "./Login";

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) return null; // brief load flash
  return session ? <CommissionProjector user={session.user} /> : <Login />;
}
