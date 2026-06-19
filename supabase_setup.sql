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
