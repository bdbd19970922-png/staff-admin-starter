// FILE: /app/global-error.tsx
'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // 화면 노출 (필요 시 축약 가능)
  return (
    <html>
      <body style={{ fontFamily: 'system-ui', padding: 20 }}>
        <h1>앱 전역 오류</h1>
        <pre style={{ whiteSpace: 'pre-wrap', background: '#f6f8fa', padding: 12 }}>
{String(error?.message || error)}
        </pre>
        <button onClick={reset} style={{ marginTop: 12, padding: '6px 10px' }}>
          다시 시도
        </button>
      </body>
    </html>
  );
}
