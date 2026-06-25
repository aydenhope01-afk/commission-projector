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
  // key by user id: tear down and re-seed all state if the signed-in user
  // changes, so one user's in-memory figures can never be saved under another's id.
  return session ? <CommissionProjector key={session.user.id} user={session.user} /> : <Login />;
}
