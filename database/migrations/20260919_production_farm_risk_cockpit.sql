-- A4PRINT HUB: Production Farm Phase 51 — tenant-scoped risk cockpit and partner dispute provenance.

alter table public.equipment_partner_responses
  add column contract_id uuid,
  add column organization_id uuid;

update public.equipment_partner_responses r
set contract_id=s.contract_id,
    organization_id=c.organization_id
from public.equipment_owner_settlements s
join public.equipment_contracts c on c.id=s.contract_id
where r.entity_type='OWNER_SETTLEMENT'
  and r.entity_id=s.id
  and (r.contract_id is null or r.organization_id is null);

update public.equipment_partner_responses r
set contract_id=l.contract_id,
    organization_id=c.organization_id
from public.equipment_lease_charges l
join public.equipment_contracts c on c.id=l.contract_id
where r.entity_type='LEASE_CHARGE'
  and r.entity_id=l.id
  and (r.contract_id is null or r.organization_id is null);

update public.equipment_partner_responses r
set contract_id=(
      select c.id
      from public.document_links dl
      join public.equipment_contracts c on c.id=dl.entity_id
      where dl.document_id=r.entity_id
        and dl.entity_type='EQUIPMENT_CONTRACT'
      order by c.created_at,c.id
      limit 1
    ),
    organization_id=(
      select c.organization_id
      from public.document_links dl
      join public.equipment_contracts c on c.id=dl.entity_id
      where dl.document_id=r.entity_id
        and dl.entity_type='EQUIPMENT_CONTRACT'
      order by c.created_at,c.id
      limit 1
    )
where r.entity_type='CONTRACT_DOCUMENT'
  and (r.contract_id is null or r.organization_id is null);

do $$
begin
  if exists(
    select 1
    from public.equipment_partner_responses
    where contract_id is null or organization_id is null
  ) then
    raise exception 'PARTNER_RESPONSE_CONTRACT_CONTEXT_MISSING';
  end if;
end
$$;

alter table public.equipment_partner_responses
  alter column contract_id set not null,
  alter column organization_id set not null;

alter table public.equipment_partner_responses
  add constraint equipment_partner_responses_contract_id_fkey
    foreign key(contract_id) references public.equipment_contracts(id) on delete restrict,
  add constraint equipment_partner_responses_organization_id_fkey
    foreign key(organization_id) references public.organizations(id) on delete restrict;

create index if not exists idx_equipment_partner_responses_org_open_dispute
  on public.equipment_partner_responses(
    organization_id,response_status,resolved_at,event_sequence desc
  );

create index if not exists idx_equipment_partner_responses_contract
  on public.equipment_partner_responses(contract_id,event_sequence desc);

drop policy if exists equipment_partner_responses_read
  on public.equipment_partner_responses;

create policy equipment_partner_responses_read
on public.equipment_partner_responses
for select to authenticated
using(
  partner_id=public.current_partner_id()
  or (
    organization_id=public.current_user_organization_id()
    and (
      public.has_permission('production.settlements.view')
      or public.has_permission('production.settlements.manage')
      or public.has_permission('equipment.contracts.manage')
    )
  )
);

CREATE OR REPLACE FUNCTION private.assert_equipment_partner_response_tenant(p_response_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row public.equipment_partner_responses%rowtype;
  v_partner_id uuid;
  v_org uuid;
begin
  if p_response_id is null then
    raise exception 'EQUIPMENT_PARTNER_RESPONSE_NOT_AVAILABLE';
  end if;

  if auth.uid() is null then
    return;
  end if;

  select * into v_row
  from public.equipment_partner_responses
  where id=p_response_id;

  if v_row.id is null then
    raise exception 'EQUIPMENT_PARTNER_RESPONSE_NOT_AVAILABLE';
  end if;

  v_partner_id:=public.current_partner_id();

  if v_partner_id is not null then
    if v_row.partner_id=v_partner_id then
      return;
    end if;
    raise exception 'EQUIPMENT_PARTNER_RESPONSE_NOT_AVAILABLE';
  end if;

  perform private.assert_non_partner_staff_context();
  v_org:=public.current_user_organization_id();

  if v_org is not null and v_row.organization_id=v_org then
    return;
  end if;

  raise exception 'EQUIPMENT_PARTNER_RESPONSE_NOT_AVAILABLE';
end
$function$;

revoke all on function private.assert_equipment_partner_response_tenant(uuid)
from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.submit_equipment_partner_response(p_entity_type text, p_entity_id uuid, p_response_status text, p_comment text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_partner_id uuid;
  v_partner_user_id uuid;
  v_type text:=upper(btrim(coalesce(p_entity_type,'')));
  v_status text:=upper(btrim(coalesce(p_response_status,'')));
  v_id uuid;
  v_last_status text;
  v_label text;
  v_contract_id uuid;
  v_org uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  v_partner_id:=public.current_partner_id();
  v_partner_user_id:=public.current_partner_user_id();

  if v_partner_id is null or v_partner_user_id is null then
    raise exception 'PARTNER_ACCESS_REQUIRED';
  end if;
  if p_entity_id is null then raise exception 'ENTITY_REQUIRED'; end if;
  if v_type not in ('OWNER_SETTLEMENT','LEASE_CHARGE','CONTRACT_DOCUMENT') then
    raise exception 'INVALID_ENTITY_TYPE';
  end if;
  if v_status not in ('ACKNOWLEDGED','DISPUTED') then
    raise exception 'INVALID_RESPONSE_STATUS';
  end if;
  if v_status='DISPUTED'
     and nullif(btrim(coalesce(p_comment,'')),'') is null then
    raise exception 'DISPUTE_COMMENT_REQUIRED';
  end if;

  if v_type='OWNER_SETTLEMENT' then
    select
      'Расчёт по договору '||c.contract_number||' за '||
        to_char(s.period_start,'DD.MM.YYYY')||'–'||to_char(s.period_end,'DD.MM.YYYY'),
      c.id,
      c.organization_id
    into v_label,v_contract_id,v_org
    from public.equipment_owner_settlements s
    join public.equipment_contracts c on c.id=s.contract_id
    where s.id=p_entity_id
      and s.partner_id=v_partner_id
      and c.partner_id=v_partner_id
      and s.status in ('APPROVED','PAID');

  elsif v_type='LEASE_CHARGE' then
    select
      case
        when lc.charge_type='BUYOUT_EXTRA' then
          'Доплата по выкупу по договору '||c.contract_number
        else
          'Арендное начисление по договору '||c.contract_number||' за '||
          to_char(lc.period_start,'DD.MM.YYYY')||'–'||to_char(lc.period_end,'DD.MM.YYYY')
      end,
      c.id,
      c.organization_id
    into v_label,v_contract_id,v_org
    from public.equipment_lease_charges lc
    join public.equipment_contracts c on c.id=lc.contract_id
    where lc.id=p_entity_id
      and lc.partner_id=v_partner_id
      and c.partner_id=v_partner_id
      and lc.status in ('APPROVED','PAID');

  else
    select
      dt.name||' '||coalesce(d.document_number,''),
      c.id,
      c.organization_id
    into v_label,v_contract_id,v_org
    from public.documents d
    join public.document_types dt on dt.id=d.document_type_id
    join public.document_links pl
      on pl.document_id=d.id
     and pl.entity_type='PARTNER'
     and pl.entity_id=v_partner_id
    join public.document_links cl
      on cl.document_id=d.id
     and cl.entity_type='EQUIPMENT_CONTRACT'
    join public.equipment_contracts c
      on c.id=cl.entity_id
     and c.partner_id=v_partner_id
    where d.id=p_entity_id
      and dt.code in(
        'EQ_ACCEPTANCE_ACT',
        'EQ_ASSET_LIST',
        'EQ_TERMS_APPENDIX',
        'EQ_RETURN_ACT',
        'EQ_RECONCILIATION_ACT',
        'EQ_CONTRACT_AMENDMENT'
      )
      and d.status in(
        'APPROVED'::public.document_status,
        'SIGNED'::public.document_status,
        'ACTIVE'::public.document_status,
        'TERMINATED'::public.document_status,
        'ARCHIVED'::public.document_status
      )
    order by c.created_at,c.id
    limit 1;
  end if;

  if v_label is null or v_contract_id is null or v_org is null then
    raise exception 'ENTITY_NOT_AVAILABLE';
  end if;

  select response_status into v_last_status
  from public.equipment_partner_responses
  where partner_id=v_partner_id
    and entity_type=v_type
    and entity_id=p_entity_id
  order by event_sequence desc
  limit 1;

  if v_last_status=v_status then
    raise exception 'RESPONSE_ALREADY_CURRENT';
  end if;

  insert into public.equipment_partner_responses(
    partner_id,partner_user_id,contract_id,organization_id,
    entity_type,entity_id,response_status,comment
  )
  values(
    v_partner_id,v_partner_user_id,v_contract_id,v_org,
    v_type,p_entity_id,v_status,
    nullif(btrim(coalesce(p_comment,'')),'')
  )
  returning id into v_id;

  if v_status='DISPUTED' then
    insert into public.notifications(
      user_id,title,body,type,entity_type,entity_id
    )
    select distinct
      u.id,
      'Расхождение от владельца оборудования',
      coalesce(v_label,'Документ/расчёт')||': '||btrim(p_comment),
      'WARNING',
      'EQUIPMENT_PARTNER_RESPONSE',
      v_id
    from public.users u
    join public.organization_units ou
      on ou.id=u.organization_unit_id
     and ou.is_active=true
     and ou.organization_id=v_org
    join public.user_roles ur on ur.user_id=u.id
    join public.roles r on r.id=ur.role_id
    left join public.role_permissions rp on rp.role_id=r.id
    left join public.permissions pp on pp.id=rp.permission_id
    where u.is_active=true
      and (
        r.name='ADMIN'
        or pp.code in(
          'production.settlements.manage',
          'equipment.contracts.manage'
        )
      );
  end if;

  return v_id;
end
$function$;

revoke all on function public.submit_equipment_partner_response(text,uuid,text,text)
from public,anon,authenticated;
grant execute on function public.submit_equipment_partner_response(text,uuid,text,text)
to authenticated;

CREATE OR REPLACE FUNCTION public.list_equipment_partner_disputes(p_include_resolved boolean DEFAULT false)
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
    public.has_permission('production.settlements.view')
    or public.has_permission('production.settlements.manage')
    or public.has_permission('equipment.contracts.manage')
  ) then
    raise exception 'PERMISSION_DENIED';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',r.id,
        'event_sequence',r.event_sequence,
        'partner_id',r.partner_id,
        'partner_name',coalesce(p.legal_name,p.name),
        'partner_user_id',r.partner_user_id,
        'partner_user_name',pu.full_name,
        'contract_id',r.contract_id,
        'contract_number',c.contract_number,
        'organization_id',r.organization_id,
        'entity_type',r.entity_type,
        'entity_id',r.entity_id,
        'response_status',r.response_status,
        'comment',r.comment,
        'created_at',r.created_at,
        'resolved_at',r.resolved_at,
        'resolution_note',r.resolution_note
      )
      order by (r.resolved_at is null) desc,r.event_sequence desc
    ),
    '[]'::jsonb
  )
  into v_result
  from public.equipment_partner_responses r
  join public.partners p on p.id=r.partner_id
  join public.partner_users pu on pu.id=r.partner_user_id
  join public.equipment_contracts c
    on c.id=r.contract_id
   and c.organization_id=v_org
  where r.organization_id=v_org
    and r.response_status='DISPUTED'
    and (
      coalesce(p_include_resolved,false)
      or r.resolved_at is null
    );

  return v_result;
end
$function$;

revoke all on function public.list_equipment_partner_disputes(boolean)
from public,anon,authenticated;
grant execute on function public.list_equipment_partner_disputes(boolean)
to authenticated;

CREATE OR REPLACE FUNCTION private.production_farm_risk_rows(p_organization_id uuid)
 RETURNS TABLE(category text, entity_id uuid, entity_type text, severity text, state text, overdue boolean, due_at timestamp with time zone, amount numeric, currency text, title text, subtitle text, href text, sort_at timestamp with time zone, meta jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    'PAYMENT_INTEGRITY'::text,
    e.id,
    'EQUIPMENT_OWNER_PAYMENT_INTEGRITY'::text,
    e.severity,
    e.status,
    e.status<>'RESOLVED' and e.due_at<now(),
    e.due_at,
    null::numeric,
    'RUB'::text,
    coalesce(nullif(p.legal_name,''),nullif(p.name,''),'Владелец')||
      ' · '||c.contract_number,
    array_to_string(e.issue_codes,', '),
    './equipment-payment-reconciliation.html'::text,
    e.last_seen_at,
    jsonb_build_object(
      'contract_id',e.contract_id,
      'partner_id',e.partner_id,
      'occurrence_count',e.occurrence_count,
      'assigned_to',e.assigned_to,
      'assigned_to_name',u.full_name,
      'escalation_count',e.escalation_count
    )
  from public.equipment_owner_payment_integrity_events e
  join public.equipment_contracts c on c.id=e.contract_id
  join public.partners p on p.id=e.partner_id
  left join public.users u on u.id=e.assigned_to
  where e.organization_id=p_organization_id
    and c.organization_id=p_organization_id
    and e.status in ('OPEN','ACKNOWLEDGED')

  union all

  select
    'PAYMENT_OBLIGATION',
    s.id,
    'OWNER_SETTLEMENT',
    case
      when s.payment_due_date is not null
       and s.payment_due_date<current_date then 'HIGH'
      when s.payment_due_date is null
        or s.payment_due_date<=current_date+3 then 'MEDIUM'
      else 'LOW'
    end,
    s.status,
    coalesce(s.payment_due_date<current_date,false),
    case
      when s.payment_due_date is null then null
      else s.payment_due_date::timestamptz
    end,
    s.owner_amount,
    s.currency,
    coalesce(nullif(p.legal_name,''),nullif(p.name,''),'Владелец')||
      ' · '||c.contract_number,
    case
      when s.payment_due_date is null
        then 'Доля владельца · срок оплаты не задан'
      else 'Доля владельца · срок '||
        to_char(s.payment_due_date,'DD.MM.YYYY')
    end,
    './equipment-payment-control.html',
    coalesce(s.approved_at,s.created_at),
    jsonb_build_object(
      'contract_id',s.contract_id,
      'partner_id',s.partner_id,
      'period_end',s.period_end
    )
  from public.equipment_owner_settlements s
  join public.equipment_contracts c on c.id=s.contract_id
  join public.partners p on p.id=s.partner_id
  where c.organization_id=p_organization_id
    and s.status not in ('PAID','CANCELLED')

  union all

  select
    'PAYMENT_OBLIGATION',
    l.id,
    'LEASE_CHARGE',
    case
      when l.payment_due_date is not null
       and l.payment_due_date<current_date then 'HIGH'
      when l.payment_due_date is null
        or l.payment_due_date<=current_date+3 then 'MEDIUM'
      else 'LOW'
    end,
    l.status,
    coalesce(l.payment_due_date<current_date,false),
    case
      when l.payment_due_date is null then null
      else l.payment_due_date::timestamptz
    end,
    l.amount,
    l.currency,
    coalesce(nullif(p.legal_name,''),nullif(p.name,''),'Владелец')||
      ' · '||c.contract_number,
    case
      when l.payment_due_date is null
        then 'Аренда / выкуп · срок оплаты не задан'
      else 'Аренда / выкуп · срок '||
        to_char(l.payment_due_date,'DD.MM.YYYY')
    end,
    './equipment-payment-control.html',
    coalesce(l.approved_at,l.created_at),
    jsonb_build_object(
      'contract_id',l.contract_id,
      'partner_id',l.partner_id,
      'period_end',l.period_end,
      'charge_type',l.charge_type
    )
  from public.equipment_lease_charges l
  join public.equipment_contracts c on c.id=l.contract_id
  join public.partners p on p.id=l.partner_id
  where c.organization_id=p_organization_id
    and l.status not in ('PAID','CANCELLED')

  union all

  select
    'CONTRACT_DEADLINE',
    c.id,
    'EQUIPMENT_CONTRACT',
    case
      when c.ends_on<current_date then 'HIGH'
      when c.ends_on<=current_date+7 then 'MEDIUM'
      else 'LOW'
    end,
    c.status,
    c.ends_on<current_date,
    c.ends_on::timestamptz,
    null::numeric,
    c.currency,
    c.contract_number||' · '||
      coalesce(nullif(p.legal_name,''),nullif(p.name,''),'Владелец'),
    case
      when c.ends_on<current_date then 'Срок договора истёк'
      else 'До окончания '||(c.ends_on-current_date)::text||' дн.'
    end,
    './equipment-contract-deadlines.html',
    c.updated_at,
    jsonb_build_object(
      'partner_id',c.partner_id,
      'contract_type',c.contract_type
    )
  from public.equipment_contracts c
  join public.partners p on p.id=c.partner_id
  where c.organization_id=p_organization_id
    and c.status in ('ACTIVE','SUSPENDED')
    and c.ends_on is not null
    and c.ends_on<=current_date+30

  union all

  select
    'CONDITION_CLAIM',
    cl.id,
    'EQUIPMENT_CONDITION_CLAIM',
    case
      when cl.status='DISPUTED' then 'HIGH'
      when cl.due_date is not null
       and cl.due_date<current_date then 'HIGH'
      when cl.due_date is not null
       and cl.due_date<=current_date+3 then 'MEDIUM'
      else 'LOW'
    end,
    cl.status,
    coalesce(cl.due_date<current_date,false),
    case
      when cl.due_date is null then null
      else cl.due_date::timestamptz
    end,
    cl.requested_amount,
    cl.currency,
    coalesce(nullif(p.legal_name,''),nullif(p.name,''),'Владелец')||
      ' · '||a.inventory_number,
    case
      when cl.status='DISPUTED'
        then 'Требование оспорено владельцем'
      when cl.due_date is null
        then 'Требование по состоянию · срок не задан'
      else 'Требование по состоянию · срок '||
        to_char(cl.due_date,'DD.MM.YYYY')
    end,
    './equipment-condition-claims.html',
    cl.updated_at,
    jsonb_build_object(
      'contract_id',cl.contract_id,
      'equipment_id',cl.equipment_id,
      'partner_id',cl.partner_id,
      'claim_direction',cl.claim_direction
    )
  from public.equipment_condition_claims cl
  join public.equipment_contracts c on c.id=cl.contract_id
  join public.equipment_assets a on a.id=cl.equipment_id
  join public.partners p on p.id=cl.partner_id
  where c.organization_id=p_organization_id
    and cl.status not in ('SETTLED','WAIVED','CANCELLED')

  union all

  select
    'PARTNER_DISPUTE',
    r.id,
    'EQUIPMENT_PARTNER_RESPONSE',
    'HIGH',
    'DISPUTED',
    false,
    null::timestamptz,
    null::numeric,
    c.currency,
    coalesce(nullif(p.legal_name,''),nullif(p.name,''),'Владелец')||
      ' · '||c.contract_number,
    case r.entity_type
      when 'OWNER_SETTLEMENT' then 'Спор по расчёту владельца'
      when 'LEASE_CHARGE' then 'Спор по арендному начислению'
      else 'Спор по документу договора'
    end||
    case
      when nullif(btrim(coalesce(r.comment,'')),'') is null then ''
      else ' · '||left(btrim(r.comment),220)
    end,
    './equipment-partner-responses.html',
    r.created_at,
    jsonb_build_object(
      'contract_id',r.contract_id,
      'partner_id',r.partner_id,
      'response_entity_type',r.entity_type,
      'response_entity_id',r.entity_id,
      'partner_user_id',r.partner_user_id
    )
  from public.equipment_partner_responses r
  join public.equipment_contracts c
    on c.id=r.contract_id
   and c.organization_id=p_organization_id
  join public.partners p on p.id=r.partner_id
  where r.organization_id=p_organization_id
    and r.response_status='DISPUTED'
    and r.resolved_at is null

  union all

  select
    'EQUIPMENT_INCIDENT',
    i.id,
    'EQUIPMENT_INCIDENT',
    i.severity,
    i.status,
    false,
    null::timestamptz,
    null::numeric,
    'RUB',
    a.inventory_number||' · '||a.name,
    i.status||' · '||left(i.description,220),
    './equipment.html',
    i.updated_at,
    jsonb_build_object(
      'equipment_id',i.equipment_id,
      'downtime_started_at',i.downtime_started_at,
      'downtime_minutes',
        greatest(
          floor(
            extract(epoch from (coalesce(i.downtime_ended_at,now())-i.downtime_started_at))/60
          ),
          0
        ),
      'responsible_user_id',i.responsible_user_id,
      'responsible_user_name',u.full_name,
      'production_job_id',i.production_job_id
    )
  from public.equipment_incidents i
  join public.equipment_assets a on a.id=i.equipment_id
  left join public.users u on u.id=i.responsible_user_id
  where a.organization_id=p_organization_id
    and i.status in ('OPEN','DIAGNOSING','WAITING_PARTS','REPAIRING')
$function$;

revoke all on function private.production_farm_risk_rows(uuid)
from public,anon,authenticated;

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
  ) then
    raise exception 'PERMISSION_DENIED';
  end if;

  select jsonb_build_object(
    'total',count(*),
    'critical',count(*) filter(where severity='CRITICAL'),
    'high',count(*) filter(where severity='HIGH'),
    'medium',count(*) filter(where severity='MEDIUM'),
    'low',count(*) filter(where severity='LOW'),
    'overdue',count(*) filter(where overdue),
    'unassigned_integrity',count(*) filter(
      where category='PAYMENT_INTEGRITY'
        and (meta->>'assigned_to') is null
    ),
    'payment_integrity',count(*) filter(where category='PAYMENT_INTEGRITY'),
    'payment_obligations',count(*) filter(where category='PAYMENT_OBLIGATION'),
    'contract_deadlines',count(*) filter(where category='CONTRACT_DEADLINE'),
    'condition_claims',count(*) filter(where category='CONDITION_CLAIM'),
    'claim_disputes',count(*) filter(
      where category='CONDITION_CLAIM'
        and state='DISPUTED'
    ),
    'partner_disputes',count(*) filter(where category='PARTNER_DISPUTE'),
    'equipment_incidents',count(*) filter(where category='EQUIPMENT_INCIDENT'),
    'critical_downtime',count(*) filter(
      where category='EQUIPMENT_INCIDENT'
        and severity in ('CRITICAL','HIGH')
        and (meta->>'downtime_started_at') is not null
    )
  )
  into v_summary
  from private.production_farm_risk_rows(v_org);

  with ranked as (
    select r.*,
      row_number() over(
        partition by r.category
        order by
          case r.severity
            when 'CRITICAL' then 0
            when 'HIGH' then 1
            when 'MEDIUM' then 2
            else 3
          end,
          r.overdue desc,
          r.due_at nulls last,
          r.sort_at desc
      ) rn
    from private.production_farm_risk_rows(v_org) r
  )
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
  )
  into v_items
  from ranked
  where rn<=v_limit;

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

select private.assert_production_farm_security_baseline();
