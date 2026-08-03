-- ExpenseSplitter v15: permanently delete an archived partner and related expenses
-- Run once in Supabase Dashboard -> SQL Editor -> New query.

create or replace function public.delete_archived_partner_data(
  p_workspace_id uuid,
  p_partner_id uuid
)
returns table (
  deleted_partner_name text,
  deleted_expenses integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_partner_name text;
  v_is_active boolean;
  v_expense_ids uuid[];
  v_deleted_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'You must be signed in.';
  end if;

  if not public.is_workspace_owner(p_workspace_id) then
    raise exception 'Only the workspace owner can permanently delete partner data.';
  end if;

  select p.name, p.is_active
  into v_partner_name, v_is_active
  from public.partners as p
  where p.id = p_partner_id
    and p.workspace_id = p_workspace_id;

  if v_partner_name is null then
    raise exception 'Partner not found in this workspace.';
  end if;

  if v_is_active then
    raise exception 'Archive the partner before permanently deleting their data.';
  end if;

  select array_agg(distinct related.expense_id)
  into v_expense_ids
  from (
    select e.id as expense_id
    from public.expenses as e
    where e.workspace_id = p_workspace_id
      and e.paid_by = p_partner_id

    union

    select ep.expense_id
    from public.expense_participants as ep
    where ep.workspace_id = p_workspace_id
      and ep.partner_id = p_partner_id
  ) as related;

  if v_expense_ids is not null then
    v_deleted_count := cardinality(v_expense_ids);

    -- Deleting expenses cascades to expense_participants.
    delete from public.expenses as e
    where e.workspace_id = p_workspace_id
      and e.id = any(v_expense_ids);
  end if;

  delete from public.partners as p
  where p.id = p_partner_id
    and p.workspace_id = p_workspace_id;

  return query
  select v_partner_name, v_deleted_count;
end;
$$;

revoke all
on function public.delete_archived_partner_data(uuid, uuid)
from public;

grant execute
on function public.delete_archived_partner_data(uuid, uuid)
to authenticated;
