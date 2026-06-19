-- 자산관리 시스템: 직접 등록분 공유 저장용 테이블
-- Supabase 대시보드 > SQL Editor 에서 한 번 실행하세요.

-- 1) 테이블 생성 (자산 객체를 data(jsonb)에 통째로 저장)
create table if not exists public.assets (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- 2) RLS(행 수준 보안) 활성화
alter table public.assets enable row level security;

-- 3) 공개 접근 정책 (로그인 없이 누구나 읽기/쓰기 — 내부용)
drop policy if exists "public_select" on public.assets;
drop policy if exists "public_insert" on public.assets;
drop policy if exists "public_update" on public.assets;
drop policy if exists "public_delete" on public.assets;

create policy "public_select" on public.assets for select using (true);
create policy "public_insert" on public.assets for insert with check (true);
create policy "public_update" on public.assets for update using (true) with check (true);
create policy "public_delete" on public.assets for delete using (true);

-- 4) 실시간 동기화 활성화 (다른 사용자 변경 자동 반영)
alter publication supabase_realtime add table public.assets;
