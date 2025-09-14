-- 간단한 RLS 정책 예시 (필요 시 수정)
-- profiles
alter table public.profiles enable row level security;

drop policy if exists "profiles_self_read" on public.profiles;
create policy "profiles_self_read" on public.profiles
for select using (auth.uid() = id or exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update" on public.profiles
for update using (auth.uid() = id or exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- schedules
alter table public.schedules enable row level security;
drop policy if exists "schedules_read" on public.schedules;
create policy "schedules_read" on public.schedules
for select using (employee_id = auth.uid() or exists(select 1 from public.profiles p where p.id = auth.uid() and p.role='admin'));

-- materials
alter table public.materials enable row level security;
drop policy if exists "materials_read" on public.materials;
create policy "materials_read" on public.materials
for select using (exists(select 1 from public.profiles p where p.id = auth.uid() and p.role='admin'));

-- expenses
alter table public.expenses enable row level security;
drop policy if exists "expenses_read" on public.expenses;
create policy "expenses_read" on public.expenses
for select using (employee_id = auth.uid() or exists(select 1 from public.profiles p where p.id = auth.uid() and p.role='admin'));

-- payrolls
alter table public.payrolls enable row level security;
drop policy if exists "payrolls_read" on public.payrolls;
create policy "payrolls_read" on public.payrolls
for select using (employee_id = auth.uid() or exists(select 1 from public.profiles p where p.id = auth.uid() and p.role='admin'));
