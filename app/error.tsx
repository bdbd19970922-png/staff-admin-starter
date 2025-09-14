// FILE: /app/error.tsx
'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div style={{ padding: 16 }}>
      <h2>페이지 오류</h2>
      <pre style={{ whiteSpace: 'pre-wrap', background: '#f6f8fa', padding: 12 }}>
{String(error?.message || error)}
      </pre>
      <button onClick={() => reset()} style={{ marginTop: 12, padding: '6px 10px' }}>
        다시 시도
      </button>
    </div>
  );
}
