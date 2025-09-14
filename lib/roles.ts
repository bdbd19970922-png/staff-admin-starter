import { supabase } from '@/lib/supabaseClient';

export async function fetchRoles() {
  const { data, error } = await supabase.rpc('app_my_roles');
  if (error) {
    console.warn('app_my_roles error:', error);
    return { is_admin: false, is_manager: false };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    is_admin: !!row?.is_admin,
    is_manager: !!row?.is_manager,
  };
}
