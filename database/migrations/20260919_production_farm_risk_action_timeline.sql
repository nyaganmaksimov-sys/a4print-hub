-- Production Farm Phase 54 — risk action timeline / notes.
-- Adds a tenant-scoped read RPC for the existing append-only cockpit action journal.
-- No money, contract, claim, payment or equipment state is mutated here.

create or replace function public.get_production_farm_risk_action_history(
  p_category text,
  p_entity_id uuid,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_org uuid:=public.current_user_organization_id();
  v_category text:=upper(btrim(coalesce(p_category,'')));
  v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
  v_total integer:=0;
  v_actions jsonb:='[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  perform private.assert_non_partner_staff_context();

  if v_org is null then
    raise exception 'ORGANIZATION_CONTEXT_REQUIRED';
  end if;

  if not(
    public.has_permission('equipment.view')
    or public.has_permission('equipment.contracts.manage')
    or public.has_permission('production.settlements.view')
    or public.has_permission('production.settlements.manage')
  ) then
    raise exception 'PERMISSION_DENIED';
  end if;

  if p_entity_id is null then
    raise exception 'RISK_ENTITY_REQUIRED';
  end if;

  if v_category not in(
    'PAYMENT_INTEGRITY',
    'PAYMENT_OBLIGATION',
    'CONTRACT_DEADLINE',
    'CONDITION_CLAIM',
    'PARTNER_DISPUTE',
    'EQUIPMENT_INCIDENT'
  ) then
    raise exception 'RISK_CATEGORY_INVALID';
  end if;

  select count(*)::integer
    into v_total
  from public.production_farm_risk_actions a
  where a.organization_id=v_org
    and a.category=v_category
    and a.entity_id=p_entity_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',x.id,
        'action_type',x.action_type,
        'note',x.note,
        'assigned_to',x.assigned_to,
        'assigned_to_name',x.assigned_to_name,
        'acted_by',x.acted_by,
        'acted_by_name',x.acted_by_name,
        'event_sequence',x.event_sequence,
        'created_at',x.created_at
      )
      order by x.event_sequence desc
    ),
    '[]'::jsonb
  )
  into v_actions
  from (
    select
      a.id,
      a.action_type,
      a.note,
      a.assigned_to,
      case when assignee_ou.organization_id=v_org then assignee.full_name else null end assigned_to_name,
      a.acted_by,
      case when actor_ou.organization_id=v_org then actor.full_name else null end acted_by_name,
      a.event_sequence,
      a.created_at
    from public.production_farm_risk_actions a
    left join public.users assignee on assignee.id=a.assigned_to
    left join public.organization_units assignee_ou on assignee_ou.id=assignee.organization_unit_id
    left join public.users actor on actor.id=a.acted_by
    left join public.organization_units actor_ou on actor_ou.id=actor.organization_unit_id
    where a.organization_id=v_org
      and a.category=v_category
      and a.entity_id=p_entity_id
    order by a.event_sequence desc
    limit v_limit
  ) x;

  return jsonb_build_object(
    'organization_id',v_org,
    'category',v_category,
    'entity_id',p_entity_id,
    'total',v_total,
    'limit',v_limit,
    'actions',v_actions
  );
end
$$;

revoke all on function public.get_production_farm_risk_action_history(text,uuid,integer)
  from public,anon,authenticated;
grant execute on function public.get_production_farm_risk_action_history(text,uuid,integer)
  to authenticated;
