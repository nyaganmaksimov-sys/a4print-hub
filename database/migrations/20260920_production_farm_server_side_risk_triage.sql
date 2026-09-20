-- A4PRINT HUB: Production Farm Phase 56 — server-side risk triage and pagination.
-- Filters are applied before LIMIT/OFFSET so Mine/Unassigned/ACK cannot miss risks outside the old per-category top-N.

CREATE OR REPLACE FUNCTION risk_private.get_production_farm_risk_cockpit_page(p_category text DEFAULT NULL::text, p_severity text DEFAULT NULL::text, p_overdue_only boolean DEFAULT false, p_triage text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid:=public.current_user_organization_id();
  v_staff uuid:=public.current_staff_user_id();
  v_category text:=nullif(upper(btrim(coalesce(p_category,''))),'');
  v_severity text:=nullif(upper(btrim(coalesce(p_severity,''))),'');
  v_triage text:=nullif(upper(btrim(coalesce(p_triage,''))),'');
  v_search text:=nullif(lower(left(btrim(coalesce(p_search,'')),120)),'');
  v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
  v_offset integer:=least(greatest(coalesce(p_offset,0),0),5000);
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_non_partner_staff_context();

  if v_org is null then raise exception 'ORGANIZATION_CONTEXT_REQUIRED'; end if;
  if not(
    public.has_permission('equipment.view')
    or public.has_permission('equipment.contracts.manage')
    or public.has_permission('production.settlements.view')
    or public.has_permission('production.settlements.manage')
  ) then raise exception 'PERMISSION_DENIED'; end if;

  if v_category is not null and v_category not in(
    'PAYMENT_INTEGRITY','PAYMENT_OBLIGATION','CONTRACT_DEADLINE',
    'CONDITION_CLAIM','PARTNER_DISPUTE','EQUIPMENT_INCIDENT'
  ) then raise exception 'RISK_CATEGORY_INVALID'; end if;

  if v_severity is not null and v_severity not in('CRITICAL','HIGH','MEDIUM','LOW') then
    raise exception 'RISK_SEVERITY_INVALID';
  end if;

  if v_triage is not null and v_triage not in('MINE','UNASSIGNED','ACK') then
    raise exception 'RISK_TRIAGE_INVALID';
  end if;

  with base as (
    select
      r.*,
      w.assigned_to work_assigned_to,
      w.acknowledged_at work_acknowledged_at,
      w.last_note work_note,
      case
        when r.category='PAYMENT_INTEGRITY'
          and nullif(r.meta->>'assigned_to','') is not null
          then (r.meta->>'assigned_to')::uuid
        else w.assigned_to
      end effective_assigned_to,
      case
        when r.category='PAYMENT_INTEGRITY'
          then r.state='ACKNOWLEDGED'
        else w.acknowledged_at is not null
      end effective_acknowledged
    from private.production_farm_actionable_risk_rows(v_org) r
    left join public.production_farm_risk_work_items w
      on w.organization_id=v_org
     and w.category=r.category
     and w.entity_id=r.entity_id
  ),
  enriched as (
    select
      b.category,b.entity_id,b.entity_type,b.severity,b.state,b.overdue,
      b.due_at,b.amount,b.currency,b.title,b.subtitle,b.href,b.sort_at,
      b.meta||jsonb_strip_nulls(jsonb_build_object(
        'risk_assigned_to',b.effective_assigned_to,
        'risk_assigned_to_name',
          case when ou.organization_id=v_org then u.full_name else null end,
        'risk_acknowledged',b.effective_acknowledged,
        'risk_acknowledged_at',b.work_acknowledged_at,
        'risk_note',b.work_note
      )) meta,
      b.effective_assigned_to,
      b.effective_acknowledged
    from base b
    left join public.users u on u.id=b.effective_assigned_to
    left join public.organization_units ou
      on ou.id=u.organization_unit_id
     and ou.is_active=true
  ),
  filtered as (
    select e.*
    from enriched e
    where (v_category is null or e.category=v_category)
      and (v_severity is null or e.severity=v_severity)
      and (not coalesce(p_overdue_only,false) or e.overdue)
      and (
        v_triage is null
        or (v_triage='MINE' and v_staff is not null and e.effective_assigned_to=v_staff)
        or (v_triage='UNASSIGNED' and e.effective_assigned_to is null)
        or (v_triage='ACK' and e.effective_acknowledged)
      )
      and (
        v_search is null
        or position(
          v_search in lower(concat_ws(
            ' ',
            e.title,e.subtitle,e.state,e.entity_type,e.category,
            e.meta->>'risk_assigned_to_name',
            e.meta->>'assigned_to_name',
            e.meta->>'risk_note'
          ))
        )>0
      )
  ),
  global_summary as (
    select jsonb_build_object(
      'total',count(*),
      'critical',count(*) filter(where severity='CRITICAL'),
      'high',count(*) filter(where severity='HIGH'),
      'medium',count(*) filter(where severity='MEDIUM'),
      'low',count(*) filter(where severity='LOW'),
      'overdue',count(*) filter(where overdue),
      'unassigned',count(*) filter(where effective_assigned_to is null),
      'acknowledged',count(*) filter(where effective_acknowledged),
      'unassigned_integrity',count(*) filter(
        where category='PAYMENT_INTEGRITY'
          and effective_assigned_to is null
      ),
      'payment_integrity',count(*) filter(where category='PAYMENT_INTEGRITY'),
      'payment_obligations',count(*) filter(where category='PAYMENT_OBLIGATION'),
      'contract_deadlines',count(*) filter(where category='CONTRACT_DEADLINE'),
      'condition_claims',count(*) filter(where category='CONDITION_CLAIM'),
      'claim_disputes',count(*) filter(
        where category='CONDITION_CLAIM' and state='DISPUTED'
      ),
      'partner_disputes',count(*) filter(where category='PARTNER_DISPUTE'),
      'equipment_incidents',count(*) filter(where category='EQUIPMENT_INCIDENT'),
      'critical_downtime',count(*) filter(
        where category='EQUIPMENT_INCIDENT'
          and severity in('CRITICAL','HIGH')
          and (meta->>'downtime_started_at') is not null
      )
    ) value
    from enriched
  ),
  filtered_summary as (
    select jsonb_build_object(
      'total',count(*),
      'critical',count(*) filter(where severity='CRITICAL'),
      'high',count(*) filter(where severity='HIGH'),
      'medium',count(*) filter(where severity='MEDIUM'),
      'low',count(*) filter(where severity='LOW'),
      'overdue',count(*) filter(where overdue),
      'unassigned',count(*) filter(where effective_assigned_to is null),
      'acknowledged',count(*) filter(where effective_acknowledged)
    ) value
    from filtered
  ),
  page_rows as (
    select f.*
    from filtered f
    order by
      case f.severity
        when 'CRITICAL' then 0
        when 'HIGH' then 1
        when 'MEDIUM' then 2
        else 3
      end,
      f.overdue desc,
      f.due_at nulls last,
      f.sort_at desc,
      f.category,
      f.entity_id
    offset v_offset
    limit v_limit
  ),
  page_items as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'category',category,
          'entity_id',entity_id,
          'entity_type',entity_type,
          'severity',severity,
          'state',state,
          'overdue',overdue,
          'due_at',due_at,
          'amount',amount,
          'currency',currency,
          'title',title,
          'subtitle',subtitle,
          'href',href,
          'meta',meta
        )
        order by
          case severity
            when 'CRITICAL' then 0
            when 'HIGH' then 1
            when 'MEDIUM' then 2
            else 3
          end,
          overdue desc,
          due_at nulls last,
          sort_at desc,
          category,
          entity_id
      ),
      '[]'::jsonb
    ) value,
    count(*) returned
    from page_rows
  ),
  counts as (
    select count(*) total
    from filtered
  )
  select jsonb_build_object(
    'organization_id',v_org,
    'generated_at',clock_timestamp(),
    'summary',g.value,
    'filtered_summary',fs.value,
    'items',pi.value,
    'page',jsonb_build_object(
      'offset',v_offset,
      'limit',v_limit,
      'returned',pi.returned,
      'total',c.total,
      'has_more',(v_offset+pi.returned)<c.total
    ),
    'filters',jsonb_strip_nulls(jsonb_build_object(
      'category',v_category,
      'severity',v_severity,
      'overdue_only',coalesce(p_overdue_only,false),
      'triage',v_triage,
      'search',v_search
    ))
  )
  into v_result
  from global_summary g
  cross join filtered_summary fs
  cross join page_items pi
  cross join counts c;

  return coalesce(v_result,jsonb_build_object(
    'organization_id',v_org,
    'generated_at',clock_timestamp(),
    'summary','{}'::jsonb,
    'filtered_summary','{}'::jsonb,
    'items','[]'::jsonb,
    'page',jsonb_build_object(
      'offset',v_offset,'limit',v_limit,'returned',0,'total',0,'has_more',false
    )
  ));
end
$function$;

revoke all on function risk_private.get_production_farm_risk_cockpit_page(text,text,boolean,text,text,integer,integer)
from public,anon,authenticated;

grant execute on function risk_private.get_production_farm_risk_cockpit_page(text,text,boolean,text,text,integer,integer)
to authenticated;

CREATE OR REPLACE FUNCTION public.get_production_farm_risk_cockpit_page(p_category text DEFAULT NULL::text, p_severity text DEFAULT NULL::text, p_overdue_only boolean DEFAULT false, p_triage text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select risk_private.get_production_farm_risk_cockpit_page(
    p_category,
    p_severity,
    p_overdue_only,
    p_triage,
    p_search,
    p_limit,
    p_offset
  )
$function$;

revoke all on function public.get_production_farm_risk_cockpit_page(text,text,boolean,text,text,integer,integer)
from public,anon,authenticated;

grant execute on function public.get_production_farm_risk_cockpit_page(text,text,boolean,text,text,integer,integer)
to authenticated;

select private.assert_production_farm_security_baseline();
