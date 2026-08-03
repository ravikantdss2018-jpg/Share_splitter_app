-- ExpenseSplitter partner archive support
-- Run once in Supabase Dashboard -> SQL Editor -> New query.

alter table public.partners
  add column if not exists is_active boolean not null default true;

create index if not exists idx_partners_workspace_active
  on public.partners(workspace_id, is_active, name);

-- Existing Row Level Security policies already allow workspace members
-- to update partners. No additional policy is required.
