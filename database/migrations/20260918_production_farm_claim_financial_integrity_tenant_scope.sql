-- A4PRINT HUB: Production Farm Phase 32 — tenant scope for Phase 30 financial integrity control.

drop policy if exists equipment_condition_claim_financial_integrity_events_staff_read
  on public.equipment_condition_claim_financial_integrity_events;

create policy equipment_condition_claim_financial_integrity_events_staff_read
on public.equipment_condition_claim_financial_integrity_events
for select to authenticated
using(
  (
    public.has_permission('equipment.view')
    or public.has_permission('equipment.contracts.manage')
    or public.has_permission('production.settlements.view')
    or public.has_permission('production.settlements.manage')
  )
  and exists(
    select 1
    from public.equipment_condition_claims c
    join public.equipment_assets ea on ea.id=c.equipment_id
    where c.id=equipment_condition_claim_financial_integrity_events.claim_id
      and ea.organization_id=public.current_user_organization_id()
  )
);

create or replace function public.get_equipment_condition_claim_financial_integrity(
  p_only_issues boolean default false
)
returns jsonb
language plpgsql
security definer
stable
set search_path=''
as $$
declare
  v_org uuid;
  v_rows jsonb;
  v_summary jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not(
    public.has_permission('equipment.view')
    or public.has_permission('equipment.contracts.manage')
    or public.has_permission('production.settlements.view')
    or public.has_permission('production.settlements.manage')
  ) then raise exception 'PERMISSION_DENIED'; end if;

  v_org:=public.current_user_organization_id();
  if v_org is null then raise exception 'ORGANIZATION_CONTEXT_REQUIRED'; end if;

  select coalesce(
    jsonb_agg(
      to_jsonb(x)
      order by (x.integrity_state='ERROR') desc,x.last_activity_at desc nulls last,x.contract_number
    ),
    '[]'::jsonb
  )
  into v_rows
  from public.equipment_condition_claim_financial_integrity_rows() x
  join public.equipment_assets ea on ea.id=x.equipment_id
  where ea.organization_id=v_org
    and (not coalesce(p_only_issues,false) or x.integrity_state='ERROR');

  select jsonb_build_object(
    'total',count(*),
    'ok',count(*) filter(where x.integrity_state='OK'),
    'errors',count(*) filter(where x.integrity_state='ERROR'),
    'pending',count(*) filter(where x.chain_state='PENDING_POSTING'),
    'active',count(*) filter(where x.chain_state='ACTIVE'),
    'reversed',count(*) filter(where x.chain_state='REVERSED'),
    'reposted',count(*) filter(where x.chain_state='REPOSTED')
  )
  into v_summary
  from public.equipment_condition_claim_financial_integrity_rows() x
  join public.equipment_assets ea on ea.id=x.equipment_id
  where ea.organization_id=v_org;

  return jsonb_build_object('summary',v_summary,'rows',v_rows);
end
$$;

revoke all on function public.get_equipment_condition_claim_financial_integrity(boolean)
  from public,anon,authenticated;
grant execute on function public.get_equipment_condition_claim_financial_integrity(boolean)
  to authenticated;
