// FILE: app/lib/getProfile.ts
import { supabase } from '@/lib/supabaseClient';

export async function getProfileById(userId: string) {
  // ✅ uuid는 문자열로 .eq 비교 → 400 방지
  const { data, error } = await supabase
    .from('profiles')
    .select('id,display_name,full_name,name,is_manager,is_admin')
    .eq('id', userId)
    .single();

  if (error) throw error;
  return data;
}
