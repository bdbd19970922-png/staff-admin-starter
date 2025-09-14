// FILE: /app/components/ClientChrome.tsx
'use client';

import { ReactNode } from 'react';
import Sidebar from '@/components/Sidebar';
import AuthBar from '@/components/AuthBar';

export default function ClientChrome({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-full flex">
      <Sidebar />
      <div className="flex-1 min-w-0">
        <AuthBar />
        {children}
      </div>
    </div>
  );
}
