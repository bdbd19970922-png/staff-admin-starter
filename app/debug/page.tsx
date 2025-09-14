'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function DebugPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [tokenShort, setTokenShort] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: session } = await supabase.auth.getSession();
      const access = session.session?.access_token ?? null;
      setTokenShort(access ? access.slice(0, 12) + '...' : null);

      const { data: user } = await supabase.auth.getUser();
      setEmail(user.user?.email ?? null);

      if (user.user?.id) {
        const { data, error } = await supabase.rpc('is_admin', { uid: user.user.id });
        if (!error) setIsAdmin(!!data);
      }
    })();
  }, []);

  return (
    <div style={{ padding: 16 }}>
      <h1>Debug</h1>
      <p>email: {email ?? '(not logged in)'}</p>
      <p>token: {tokenShort ?? '(no token)'}</p>
      <p>is_admin(rpc): {isAdmin === null ? '(loading)' : String(isAdmin)}</p>
    </div>
  );
}
