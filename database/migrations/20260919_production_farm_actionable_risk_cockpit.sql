-- A4PRINT HUB: Production Farm Phase 52 — actionable risk cockpit.

create table public.production_farm_risk_work_items(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  category text not null check(category in(
    'PAYMENT_INTEGRITY',
    'PAYMENT_OBLIGATION',
    'CONTRACT_DEADLINE',
    'CONDITION_CLAIM',
    'PARTNER_DISPUTE',
    'EQUIPMENT_INCIDENT'
  )),
  entity_id uuid not null,
  entity_type text not null,
  assigned_to uuid null references public.users(id) on delete set null,
  assigned_at timestamptz null,
  acknowledged_by uuid null references public.users(id) on delete set null,
  acknowledged_at timestamptz null,
  last_note text null,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(organization_id,category,entity_id)
);

create index idx_production_farm_risk_work_items_assignee
  on public.production_farm_risk_work_items(organization_id,assigned_to)
  where assigned_to is not null;

alter table public.production_farm_risk_work_items enable row level security;
revoke all on table public.production_farm_risk_work_items
from public,anon,authenticated;

create table public.production_farm_risk_actions(
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid null references public.production_farm_risk_work_items(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  category text not null,
  entity_id uuid not null,
  action_type text not null check(action_type in('ASSIGNED','ACKNOWLEDGED','NOTE')),
  assigned_to uuid null references public.users(id) on delete set null,
  note text not null,
  acted_by uuid not null references public.users(id) on delete restrict,
  event_sequence bigint generated always as identity,
  created_at timestamptz not null default clock_timestamp()
);

create index idx_production_farm_risk_actions_entity
  on public.production_farm_risk_actions(
    organization_id,category,entity_id,event_sequence desc
  );

alter table public.production_farm_risk_actions enable row level security;
revoke all on table public.production_farm_risk_actions
from public,anon,authenticated;

create table public.production_farm_risk_digest_runs(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  digest_date date not null,
  summary jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(organization_id,digest_date)
);

alter table public.production_farm_risk_digest_runs enable row level security;
revoke all on table public.production_farm_risk_digest_runs
from public,anon,authenticated;

CREATE OR REPLACE FUNCTION private.guard_production_farm_risk_action_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  raise exception 'PRODUCTION_FARM_RISK_ACTION_APPEND_ONLY';
end
$function$;

revoke all on function private.guard_production_farm_risk_action_append_only()
from public,anon,authenticated;

create trigger trg_production_farm_risk_actions_append_only
before update or delete on public.production_farm_risk_actions
for each row execute function private.guard_production_farm_risk_action_append_only();

CREATE OR REPLACE FUNCTION private.production_farm_risk_sla_interval(p_severity text)
 RETURNS interval
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case upper(coalesce(p_severity,'LOW'))
    when 'CRITICAL' then interval '4 hours'
    when 'HIGH' then interval '24 hours'
    when 'MEDIUM' then interval '72 hours'
    else interval '168 hours'
  end
$function$;

revoke all on function private.production_farm_risk_sla_interval(text)
from public,anon,authenticated;

CREATE OR REPLACE FUNCTION private.production_farm_actionable_risk_rows(p_organization_id uuid)
 RETURNS TABLE(category text, entity_id uuid, entity_type text, severity text, state text, overdue boolean, due_at timestamp with time zone, amount numeric, currency text, title text, subtitle text, href text, sort_at timestamp with time zone, meta jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    r.category,
    r.entity_id,
    r.entity_type,
    r.severity,
    r.state,
    case
      when r.category='PARTNER_DISPUTE' then
        r.sort_at+private.production_farm_risk_sla_interval(r.severity)<now()
      when r.category='EQUIPMENT_INCIDENT'
       and nullif(r.meta->>'downtime_started_at','') is not null then
        (r.meta->>'downtime_started_at')::timestamptz+
          private.production_farm_risk_sla_interval(r.severity)<now()
      else r.overdue
    end,
    case
      when r.category='PARTNER_DISPUTE' then
        r.sort_at+private.production_farm_risk_sla_interval(r.severity)
      when r.category='EQUIPMENT_INCIDENT'
       and nullif(r.meta->>'downtime_started_at','') is not null then
        (r.meta->>'downtime_started_at')::timestamptz+
          private.production_farm_risk_sla_interval(r.severity)
      else r.due_at
    end,
    r.amount,
    r.currency,
    r.title,
    r.subtitle,
    case r.category
      when 'PAYMENT_INTEGRITY' then
        './equipment-payment-reconciliation.html?event='||r.entity_id::text
      when 'PAYMENT_OBLIGATION' then
        './equipment-payment-control.html?entity_type='||
          lower(r.entity_type)||'&entity_id='||r.entity_id::text
      when 'CONTRACT_DEADLINE' then
        './equipment-contract-deadlines.html?contract='||r.entity_id::text
      when 'CONDITION_CLAIM' then
        './equipment-condition-claims.html?claim='||r.entity_id::text
      when 'PARTNER_DISPUTE' then
        './equipment-partner-responses.html?response='||r.entity_id::text
      when 'EQUIPMENT_INCIDENT' then
        './equipment.html?incident='||r.entity_id::text
      else r.href
    end,
    r.sort_at,
    r.meta||jsonb_build_object(
      'age_minutes',
      greatest(floor(extract(epoch from (now()-r.sort_at))/60),0),
      'operational_sla_hours',
      extract(epoch from private.production_farm_risk_sla_interval(r.severity))/3600
    )
  from private.production_farm_risk_rows(p_organization_id) r
$function$;

revoke all on function private.production_farm_actionable_risk_rows(uuid)
from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_production_farm_risk_assignees()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid:=public.current_user_organization_id();
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_non_partner_staff_context();

  if v_org is null then raise exception 'ORGANIZATION_CONTEXT_REQUIRED'; end if;
  if not(
    public.has_permission('equipment.contracts.manage')
    or public.has_permission('production.settlements.manage')
    or public.has_permission('equipment.repair')
    or public.has_permission('production.manage')
  ) then
    raise exception 'PERMISSION_DENIED';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('id',u.id,'full_name',u.full_name)
      order by u.full_name,u.id
    ),
    '[]'::jsonb
  )
  into v_result
  from public.users u
  join public.organization_units ou
    on ou.id=u.organization_unit_id
   and ou.is_active=true
   and ou.organization_id=v_org
  where u.is_active=true
    and (
      exists(
        select 1
        from public.user_roles ur
        join public.roles ro on ro.id=ur.role_id
        where ur.user_id=u.id
          and ro.name='ADMIN'
      )
      or exists(
        select 1
        from public.user_roles ur
        join public.role_permissions rp on rp.role_id=ur.role_id
        join public.permissions p on p.id=rp.permission_id
        where ur.user_id=u.id
          and p.code in(
            'equipment.contracts.manage',
            'production.settlements.manage',
            'equipment.repair',
            'production.manage'
          )
      )
    );

  return v_result;
end
$function$;

revoke all on function public.get_production_farm_risk_assignees()
from public,anon,authenticated;
grant execute on function public.get_production_farm_risk_assignees()
to authenticated;

CREATE OR REPLACE FUNCTION public.apply_production_farm_risk_action(p_category text, p_entity_id uuid, p_action text, p_assigned_to uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid:=public.current_user_organization_id();
  v_category text:=upper(btrim(coalesce(p_category,'')));
  v_action text:=upper(btrim(coalesce(p_action,'')));
  v_actor uuid:=public.current_staff_user_id();
  v_risk record;
  v_work public.production_farm_risk_work_items%rowtype;
  v_action_id uuid;
  v_assignee_name text;
  v_integrity_action uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_non_partner_staff_context();

  if v_org is null then raise exception 'ORGANIZATION_CONTEXT_REQUIRED'; end if;
  if not(
    public.has_permission('equipment.contracts.manage')
    or public.has_permission('production.settlements.manage')
    or public.has_permission('equipment.repair')
    or public.has_permission('production.manage')
  ) then
    raise exception 'PERMISSION_DENIED';
  end if;

  if p_entity_id is null then raise exception 'RISK_ENTITY_REQUIRED'; end if;
  if v_action not in('ASSIGN','ACKNOWLEDGE','NOTE') then
    raise exception 'RISK_ACTION_INVALID';
  end if;
  if nullif(btrim(coalesce(p_note,'')),'') is null
     or length(btrim(p_note))<3 then
    raise exception 'RISK_ACTION_NOTE_REQUIRED';
  end if;

  select * into v_risk
  from private.production_farm_actionable_risk_rows(v_org) r
  where r.category=v_category
    and r.entity_id=p_entity_id
  limit 1;

  if v_risk.entity_id is null then
    raise exception 'RISK_NOT_AVAILABLE';
  end if;

  if v_action='ASSIGN' then
    if p_assigned_to is null then raise exception 'RISK_ASSIGNEE_REQUIRED'; end if;

    select u.full_name into v_assignee_name
    from public.users u
    join public.organization_units ou
      on ou.id=u.organization_unit_id
     and ou.is_active=true
     and ou.organization_id=v_org
    where u.id=p_assigned_to
      and u.is_active=true
      and (
        exists(
          select 1
          from public.user_roles ur
          join public.roles ro on ro.id=ur.role_id
          where ur.user_id=u.id and ro.name='ADMIN'
        )
        or exists(
          select 1
          from public.user_roles ur
          join public.role_permissions rp on rp.role_id=ur.role_id
          join public.permissions p on p.id=rp.permission_id
          where ur.user_id=u.id
            and p.code in(
              'equipment.contracts.manage',
              'production.settlements.manage',
              'equipment.repair',
              'production.manage'
            )
        )
      );

    if v_assignee_name is null then raise exception 'RISK_ASSIGNEE_NOT_AVAILABLE'; end if;
  end if;

  if v_category='PAYMENT_INTEGRITY' and v_action='ASSIGN' then
    v_integrity_action:=public.assign_equipment_owner_payment_integrity_incident(
      p_entity_id,p_assigned_to,btrim(p_note)
    );
  elsif v_category='PAYMENT_INTEGRITY' and v_action='ACKNOWLEDGE' then
    v_integrity_action:=public.set_equipment_owner_payment_integrity_incident_state(
      p_entity_id,'ACKNOWLEDGED',btrim(p_note),null
    );
  else
    insert into public.production_farm_risk_work_items(
      organization_id,category,entity_id,entity_type,
      assigned_to,assigned_at,acknowledged_by,acknowledged_at,
      last_note,created_by
    ) values(
      v_org,v_category,p_entity_id,v_risk.entity_type,
      case when v_action='ASSIGN' then p_assigned_to else null end,
      case when v_action='ASSIGN' then clock_timestamp() else null end,
      case when v_action='ACKNOWLEDGE' then v_actor else null end,
      case when v_action='ACKNOWLEDGE' then clock_timestamp() else null end,
      btrim(p_note),v_actor
    )
    on conflict(organization_id,category,entity_id) do update
    set assigned_to=case
          when v_action='ASSIGN' then excluded.assigned_to
          else public.production_farm_risk_work_items.assigned_to
        end,
        assigned_at=case
          when v_action='ASSIGN' then excluded.assigned_at
          else public.production_farm_risk_work_items.assigned_at
        end,
        acknowledged_by=case
          when v_action='ACKNOWLEDGE' then excluded.acknowledged_by
          else public.production_farm_risk_work_items.acknowledged_by
        end,
        acknowledged_at=case
          when v_action='ACKNOWLEDGE' then excluded.acknowledged_at
          else public.production_farm_risk_work_items.acknowledged_at
        end,
        last_note=excluded.last_note,
        updated_at=clock_timestamp()
    returning * into v_work;
  end if;

  insert into public.production_farm_risk_actions(
    work_item_id,organization_id,category,entity_id,
    action_type,assigned_to,note,acted_by
  ) values(
    case when v_category='PAYMENT_INTEGRITY' then null else v_work.id end,
    v_org,v_category,p_entity_id,
    case v_action
      when 'ASSIGN' then 'ASSIGNED'
      when 'ACKNOWLEDGE' then 'ACKNOWLEDGED'
      else 'NOTE'
    end,
    case when v_action='ASSIGN' then p_assigned_to else null end,
    btrim(p_note),v_actor
  )
  returning id into v_action_id;

  if v_action='ASSIGN' and v_category<>'PAYMENT_INTEGRITY' then
    insert into public.notifications(
      user_id,title,body,type,entity_type,entity_id
    ) values(
      p_assigned_to,
      'Назначен риск Production Farm',
      v_risk.title||' · '||v_category,
      case when v_risk.severity in('CRITICAL','HIGH') then 'WARNING' else 'INFO' end,
      'PRODUCTION_FARM_RISK',
      v_action_id
    );
  end if;

  return jsonb_build_object(
    'action_id',v_action_id,
    'delegated_action_id',v_integrity_action,
    'category',v_category,
    'entity_id',p_entity_id,
    'action',v_action
  );
end
$function$;

revoke all on function public.apply_production_farm_risk_action(text,uuid,text,uuid,text)
from public,anon,authenticated;
grant execute on function public.apply_production_farm_risk_action(text,uuid,text,uuid,text)
to authenticated;

CREATE OR REPLACE FUNCTION public.get_production_farm_risk_cockpit(p_limit_per_category integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid:=public.current_user_organization_id();
  v_limit integer:=least(greatest(coalesce(p_limit_per_category,12),1),50);
  v_summary jsonb;
  v_items jsonb;
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
        'risk_assigned_to_name',u.full_name,
        'risk_acknowledged',b.effective_acknowledged,
        'risk_acknowledged_at',b.work_acknowledged_at,
        'risk_note',b.work_note
      )) meta,
      b.effective_assigned_to,
      b.effective_acknowledged
    from base b
    left join public.users u on u.id=b.effective_assigned_to
  ),
  ranked as (
    select e.*,
      row_number() over(
        partition by e.category
        order by
          case e.severity
            when 'CRITICAL' then 0
            when 'HIGH' then 1
            when 'MEDIUM' then 2
            else 3
          end,
          e.overdue desc,
          e.due_at nulls last,
          e.sort_at desc
      ) rn
    from enriched e
  ),
  summary_row as (
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
  items_row as (
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
          sort_at desc
      ),
      '[]'::jsonb
    ) value
    from ranked
    where rn<=v_limit
  )
  select s.value,i.value
    into v_summary,v_items
  from summary_row s
  cross join items_row i;

  return jsonb_build_object(
    'organization_id',v_org,
    'generated_at',clock_timestamp(),
    'summary',coalesce(v_summary,'{}'::jsonb),
    'items',coalesce(v_items,'[]'::jsonb)
  );
end
$function$;

revoke all on function public.get_production_farm_risk_cockpit(integer)
from public,anon,authenticated;
grant execute on function public.get_production_farm_risk_cockpit(integer)
to authenticated;

CREATE OR REPLACE FUNCTION public.emit_production_farm_risk_digest()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  o record;
  v_summary jsonb;
  v_digest_id uuid;
  v_count integer:=0;
begin
  for o in
    select id
    from public.organizations
    where is_active=true
  loop
    select jsonb_build_object(
      'total',count(*),
      'critical',count(*) filter(where severity='CRITICAL'),
      'high',count(*) filter(where severity='HIGH'),
      'overdue',count(*) filter(where overdue),
      'payment_integrity',count(*) filter(where category='PAYMENT_INTEGRITY'),
      'payment_obligations',count(*) filter(where category='PAYMENT_OBLIGATION'),
      'partner_disputes',count(*) filter(where category='PARTNER_DISPUTE'),
      'equipment_incidents',count(*) filter(where category='EQUIPMENT_INCIDENT')
    )
    into v_summary
    from private.production_farm_actionable_risk_rows(o.id);

    if coalesce((v_summary->>'total')::integer,0)=0 then
      continue;
    end if;

    if coalesce((v_summary->>'critical')::integer,0)=0
       and coalesce((v_summary->>'high')::integer,0)=0
       and coalesce((v_summary->>'overdue')::integer,0)=0
    then
      continue;
    end if;

    v_digest_id:=null;

    insert into public.production_farm_risk_digest_runs(
      organization_id,digest_date,summary
    ) values(
      o.id,current_date,v_summary
    )
    on conflict(organization_id,digest_date) do nothing
    returning id into v_digest_id;

    if v_digest_id is null then
      continue;
    end if;

    insert into public.notifications(
      user_id,title,body,type,entity_type,entity_id
    )
    select distinct
      u.id,
      'Production Farm · сводка рисков',
      'CRITICAL: '||coalesce(v_summary->>'critical','0')||
      ' · HIGH: '||coalesce(v_summary->>'high','0')||
      ' · просрочено: '||coalesce(v_summary->>'overdue','0')||
      ' · всего: '||coalesce(v_summary->>'total','0'),
      case
        when coalesce((v_summary->>'critical')::integer,0)>0 then 'WARNING'
        else 'INFO'
      end,
      'PRODUCTION_FARM_RISK_DIGEST',
      v_digest_id
    from public.users u
    join public.organization_units ou
      on ou.id=u.organization_unit_id
     and ou.is_active=true
     and ou.organization_id=o.id
    where u.is_active=true
      and (
        exists(
          select 1
          from public.user_roles ur
          join public.roles ro on ro.id=ur.role_id
          where ur.user_id=u.id and ro.name='ADMIN'
        )
        or exists(
          select 1
          from public.user_roles ur
          join public.role_permissions rp on rp.role_id=ur.role_id
          join public.permissions p on p.id=rp.permission_id
          where ur.user_id=u.id
            and p.code in(
              'equipment.contracts.manage',
              'production.settlements.manage',
              'equipment.repair',
              'production.manage'
            )
        )
      );

    v_count:=v_count+1;
  end loop;

  return v_count;
end
$function$;

revoke all on function public.emit_production_farm_risk_digest()
from public,anon,authenticated;

do $$
declare
  v_job bigint;
begin
  select jobid into v_job
  from cron.job
  where jobname='production-farm-risk-digest-daily'
  order by jobid
  limit 1;

  if v_job is not null then
    perform cron.unschedule(v_job);
  end if;

  perform cron.schedule(
    'production-farm-risk-digest-daily',
    '30 7 * * *',
    'select public.emit_production_farm_risk_digest();'
  );
end
$$;

select private.assert_production_farm_security_baseline();
