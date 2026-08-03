-- ExpenseSplitter feedback storage
-- Run this once in Supabase Dashboard -> SQL Editor -> New query.

create table if not exists public.app_feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null
    references public.workspaces(id) on delete cascade,
  user_id uuid not null
    references auth.users(id) on delete cascade,
  user_email text not null default '',
  contact_email text not null default '',
  feedback_type text not null
    check (
      feedback_type in (
        'bug',
        'usability',
        'calculation',
        'performance',
        'suggestion',
        'other'
      )
    ),
  screen_name text not null default 'other',
  rating integer not null check (rating between 1 and 5),
  message text not null
    check (char_length(trim(message)) between 3 and 2000),
  payment_interest text not null default 'not_sure'
    check (
      payment_interest in (
        'yes_99',
        'yes_199',
        'maybe',
        'no',
        'not_sure'
      )
    ),
  desired_feature text not null default 'other',
  device_info text not null default ''
    check (char_length(device_info) <= 1000),
  app_version text not null default '',
  status text not null default 'new'
    check (status in ('new', 'reviewing', 'planned', 'fixed', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_app_feedback_workspace_created
  on public.app_feedback(workspace_id, created_at desc);

alter table public.app_feedback enable row level security;

drop policy if exists "Members submit feedback" on public.app_feedback;
create policy "Members submit feedback"
on public.app_feedback
for insert
to authenticated
with check (
  (select public.is_workspace_member(workspace_id))
  and user_id = (select auth.uid())
);

drop policy if exists "Users and owners read feedback" on public.app_feedback;
create policy "Users and owners read feedback"
on public.app_feedback
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select public.is_workspace_owner(workspace_id))
);

drop policy if exists "Owners update feedback" on public.app_feedback;
create policy "Owners update feedback"
on public.app_feedback
for update
to authenticated
using ((select public.is_workspace_owner(workspace_id)))
with check ((select public.is_workspace_owner(workspace_id)));

grant select, insert, update
on public.app_feedback
to authenticated;

alter table public.app_feedback replica identity full;

do $$
begin
  alter publication supabase_realtime
    add table public.app_feedback;
exception
  when duplicate_object then null;
end $$;
