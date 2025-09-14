// FILE: /app/env-check/page.tsx
export default function EnvCheckPage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  let host = ''; try { host = new URL(url).host } catch {}
  return (
    <pre className="p-4">
      {JSON.stringify({
        env: process.env.NODE_ENV,
        supabaseHost: host,
        anonPreview: anon ? anon.slice(0, 6) + '...' : '',
      }, null, 2)}
    </pre>
  );
}
