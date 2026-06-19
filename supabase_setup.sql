-- 자산관리 시스템: 공유 저장 + 관리자 승인제
-- Supabase 대시보드 > SQL Editor 에서 실행하세요. (이미 1차 SQL을 실행했어도 안전하게 재실행 가능)

-- 1) 승인된 오버레이 테이블 (직접등록/엑셀수정/엑셀삭제 결과)
create table if not exists public.assets (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
-- kind: added(직접등록) | override(엑셀자산 수정) | deleted(엑셀자산 삭제)
alter table public.assets add column if not exists kind text not null default 'added';

-- 2) 변경요청 테이블 (일반 사용자 요청 → 관리자 승인)
create table if not exists public.requests (
  id uuid primary key default gen_random_uuid(),
  action text not null,                      -- create | update | delete
  target_id text,                            -- 대상 자산 id (update/delete)
  payload jsonb,                             -- 제안 데이터
  requester text default '',                 -- 요청자 이름
  note text default '',                      -- 요청 사유
  status text not null default 'pending',    -- pending | approved | rejected
  created_at timestamptz not null default now()
);

-- 3) RLS 활성화
alter table public.assets enable row level security;
alter table public.requests enable row level security;

-- 4) assets 정책: 읽기는 모두 / 쓰기는 로그인한 관리자만
drop policy if exists "public_select" on public.assets;
drop policy if exists "public_insert" on public.assets;
drop policy if exists "public_update" on public.assets;
drop policy if exists "public_delete" on public.assets;
drop policy if exists "admin_insert" on public.assets;
drop policy if exists "admin_update" on public.assets;
drop policy if exists "admin_delete" on public.assets;

create policy "assets_select_all" on public.assets for select using (true);
create policy "assets_insert_admin" on public.assets for insert to authenticated with check (true);
create policy "assets_update_admin" on public.assets for update to authenticated using (true) with check (true);
create policy "assets_delete_admin" on public.assets for delete to authenticated using (true);

-- 5) requests 정책: 누구나 'pending' 요청 등록/읽기 / 처리(수정·삭제)는 관리자만
drop policy if exists "req_select" on public.requests;
drop policy if exists "req_insert" on public.requests;
drop policy if exists "req_update" on public.requests;
drop policy if exists "req_delete" on public.requests;

create policy "req_select_all" on public.requests for select using (true);
create policy "req_insert_pending" on public.requests for insert with check (status = 'pending');
create policy "req_update_admin" on public.requests for update to authenticated using (true) with check (true);
create policy "req_delete_admin" on public.requests for delete to authenticated using (true);

-- 6) 결재/변경 이력 테이블 (스냅샷 기반, 되돌리기용)
create table if not exists public.history (
  id uuid primary key default gen_random_uuid(),
  asset_id text,
  asset_name text default '',
  action text not null,              -- create | update | delete | revert
  before_snap jsonb,                 -- 변경 전 상태 (null이면 그 시점에 없던 자산)
  after_snap jsonb,                  -- 변경 후 상태 (null이면 삭제됨)
  requester text default '',
  note text default '',
  approved_by text default '',
  created_at timestamptz not null default now()
);
alter table public.history enable row level security;
drop policy if exists "hist_select_admin" on public.history;
drop policy if exists "hist_insert_admin" on public.history;
drop policy if exists "hist_delete_admin" on public.history;
create policy "hist_select_admin" on public.history for select to authenticated using (true);
create policy "hist_insert_admin" on public.history for insert to authenticated with check (true);
create policy "hist_delete_admin" on public.history for delete to authenticated using (true);

-- 7) 실시간 동기화
alter publication supabase_realtime add table public.assets;
alter publication supabase_realtime add table public.requests;


-- =====================================================================
-- [회원/로그인 단계] 사용자 로그인·가입 + 권한(profiles) + 알림/내 신청
-- 이 블록을 SQL Editor에서 한 번 실행하세요. (재실행 안전)
-- =====================================================================

-- A) 회원 프로필 테이블 (role: user | admin)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  username text,
  role text not null default 'user',
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- B) 관리자 판별 함수 (RLS 재귀 방지를 위해 SECURITY DEFINER)
create or replace function public.is_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- C) 신규 가입 시 프로필 자동 생성 + 기존 사용자 백필
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, username)
  values (new.id, new.email, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id, email, username)
select id, email, split_part(email, '@', 1) from auth.users
on conflict (id) do nothing;

-- D) profiles 정책: 본인/관리자 조회, 관리는 관리자
drop policy if exists "profiles_select" on public.profiles;
drop policy if exists "profiles_admin_all" on public.profiles;
create policy "profiles_select" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy "profiles_admin_all" on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- E) requests: 신청자 연결 + 처리일시 컬럼
alter table public.requests add column if not exists user_id uuid;
alter table public.requests add column if not exists decided_at timestamptz;

-- F) requests 정책 재설정 (모두 로그인 체제)
drop policy if exists "req_select_all" on public.requests;
drop policy if exists "req_insert_pending" on public.requests;
drop policy if exists "req_update_admin" on public.requests;
drop policy if exists "req_delete_admin" on public.requests;
drop policy if exists "req_select" on public.requests;
drop policy if exists "req_insert_own" on public.requests;
drop policy if exists "req_update_own" on public.requests;
drop policy if exists "req_delete_own" on public.requests;

create policy "req_select" on public.requests for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "req_insert_own" on public.requests for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');
create policy "req_update_own" on public.requests for update to authenticated
  using (user_id = auth.uid() and status = 'pending')
  with check (user_id = auth.uid() and status = 'pending');
create policy "req_update_admin" on public.requests for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "req_delete_own" on public.requests for delete to authenticated
  using (user_id = auth.uid() and status = 'pending');
create policy "req_delete_admin" on public.requests for delete to authenticated
  using (public.is_admin());

-- G) assets / history 쓰기는 '관리자만' (모두 로그인하므로 authenticated → is_admin)
drop policy if exists "assets_insert_admin" on public.assets;
drop policy if exists "assets_update_admin" on public.assets;
drop policy if exists "assets_delete_admin" on public.assets;
create policy "assets_insert_admin" on public.assets for insert to authenticated with check (public.is_admin());
create policy "assets_update_admin" on public.assets for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "assets_delete_admin" on public.assets for delete to authenticated using (public.is_admin());

drop policy if exists "hist_select_admin" on public.history;
drop policy if exists "hist_insert_admin" on public.history;
drop policy if exists "hist_delete_admin" on public.history;
create policy "hist_select_admin" on public.history for select to authenticated using (public.is_admin());
create policy "hist_insert_admin" on public.history for insert to authenticated with check (public.is_admin());
create policy "hist_delete_admin" on public.history for delete to authenticated using (public.is_admin());

-- H) 실시간
alter publication supabase_realtime add table public.profiles;

-- I) 관리자 지정 — 본인 계정 이메일로 바꿔서 실행하세요!
--    (사이트에서 그 아이디로 먼저 회원가입한 뒤 실행)
-- update public.profiles set role = 'admin' where email = '아이디@inje.ac.kr';
