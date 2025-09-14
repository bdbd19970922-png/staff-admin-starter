import { cookies } from 'next/headers';
import { createServerComponentClient, createRouteHandlerClient, createMiddlewareClient } from '@supabase/auth-helpers-nextjs';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export const serverClient = () => createServerComponentClient({ cookies });

export const routeClient = () => createRouteHandlerClient({ cookies });

export const withAuthMiddleware = async (req: NextRequest) => {
  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req, res });
  await supabase.auth.getSession();
  return { supabase, res };
};
