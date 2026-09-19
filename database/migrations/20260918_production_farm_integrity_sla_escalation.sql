-- A4PRINT HUB: Production Farm Phase 50 — owner-payment integrity SLA, assignment and escalation.

CREATE OR REPLACE FUNCTION private.equipment_owner_payment_integrity_severity(p_issue_codes text[])
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when coalesce(p_issue_codes,'{}'::text[]) && array[
      'LEDGER_ENTITY_NOT_FOUND',
      'PAID_WITHOUT_ACTIVE_POSTING',
      'MULTIPLE_ACTIVE_POSTINGS',
      'POSTING_ORGANIZATION_MISMATCH',
      'ORIGINAL_ORGANIZATION_MISMATCH',
      'REVERSAL_ORGANIZATION_MISMATCH'
    ]::text[] then 'CRITICAL'
    when exists(
      select 1
      from unnest(coalesce(p_issue_codes,'{}'::text[])) c(code)
      where code in(
        'ACTIVE_POSTING_ON_NON_PAID',
        'ORIGINAL_TRANSACTION_MISSING',
        'REVERSAL_TRANSACTION_MISSING'
      )
      or code like '%AMOUNT_MISMATCH'
      or code like '%ACCOUNT_%'
      or code like '%DIRECTION_%'
    ) then 'HIGH'
    when cardinality(coalesce(p_issue_codes,'{}'::text[]))>0 then 'MEDIUM'
    else 'LOW'
  end
$function$
;

revoke all on function private.equipment_owner_payment_integrity_severity(text[])
from public,anon,authenticated;

CREATE OR REPLACE FUNCTION private.equipment_owner_payment_integrity_sla_interval(p_severity text)
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
$function$
;

revoke all on function private.equipment_owner_payment_integrity_sla_interval(text)
from public,anon,authenticated;

alter table public.equipment_owner_payment_integrity_events
  add column if not exists severity text,
  add column if not exists due_at timestamptz,
  add column if not exists assigned_to uuid references public.users(id) on delete set null,
  add column if not exists assigned_at timestamptz,
  add column if not exists last_escalated_at timestamptz,
  add column if not exists escalation_count integer not null default 0;

update public.equipment_owner_payment_integrity_events e
set severity=private.equipment_owner_payment_integrity_severity(e.issue_codes)
where e.severity is null;

update public.equipment_owner_payment_integrity_events e
set due_at=e.detected_at+
  private.equipment_owner_payment_integrity_sla_interval(e.severity)
where e.due_at is null;

alter table public.equipment_owner_payment_integrity_events
  alter column severity set not null,
  alter column due_at set not null;

alter table public.equipment_owner_payment_integrity_events
  drop constraint if exists equipment_owner_payment_integrity_events_severity_check;
alter table public.equipment_owner_payment_integrity_events
  add constraint equipment_owner_payment_integrity_events_severity_check
  check(severity in ('LOW','MEDIUM','HIGH','CRITICAL'));

alter table public.equipment_owner_payment_integrity_events
  drop constraint if exists equipment_owner_payment_integrity_events_escalation_count_check;
alter table public.equipment_owner_payment_integrity_events
  add constraint equipment_owner_payment_integrity_events_escalation_count_check
  check(escalation_count>=0);

create index if not exists idx_equipment_owner_payment_integrity_due
  on public.equipment_owner_payment_integrity_events(organization_id,status,due_at);

alter table public.equipment_owner_payment_integrity_actions
  drop constraint if exists equipment_owner_payment_integrity_actions_action_type_check;
alter table public.equipment_owner_payment_integrity_actions
  add constraint equipment_owner_payment_integrity_actions_action_type_check
  check(action_type in('ACKNOWLEDGED','RESOLVED','REOPENED','ASSIGNED','ESCALATED'));

CREATE OR REPLACE FUNCTION public.get_equipment_owner_payment_integrity_assignees()
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
  ) then raise exception 'PERMISSION_DENIED'; end if;

  select coalesce(jsonb_agg(
    jsonb_build_object('id',u.id,'full_name',u.full_name)
    order by u.full_name,u.id
  ),'[]'::jsonb)
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
            'production.settlements.manage'
          )
      )
    );

  return v_result;
end
$function$
;

revoke all on function public.get_equipment_owner_payment_integrity_assignees()
from public,anon,authenticated;
grant execute on function public.get_equipment_owner_payment_integrity_assignees()
to authenticated;

CREATE OR REPLACE FUNCTION public.assign_equipment_owner_payment_integrity_incident(p_event_id uuid, p_assigned_to uuid, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid:=public.current_user_organization_id();
  v_event public.equipment_owner_payment_integrity_events%rowtype;
  v_actor uuid;
  v_action_id uuid;
  v_assignee_name text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_non_partner_staff_context();

  if v_org is null then raise exception 'ORGANIZATION_CONTEXT_REQUIRED'; end if;
  if not(
    public.has_permission('equipment.contracts.manage')
    or public.has_permission('production.settlements.manage')
  ) then raise exception 'PERMISSION_DENIED'; end if;
  if p_event_id is null then raise exception 'INTEGRITY_EVENT_REQUIRED'; end if;
  if p_assigned_to is null then raise exception 'INTEGRITY_ASSIGNEE_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_note,'')),'') is null
     or length(btrim(p_note))<3 then
    raise exception 'INTEGRITY_ASSIGNMENT_NOTE_REQUIRED';
  end if;

  select * into v_event
  from public.equipment_owner_payment_integrity_events
  where id=p_event_id
  for update;

  if v_event.id is null
     or v_event.organization_id is distinct from v_org then
    raise exception 'INTEGRITY_EVENT_NOT_AVAILABLE';
  end if;
  if v_event.status='RESOLVED' then
    raise exception 'RESOLVED_INTEGRITY_EVENT_IMMUTABLE';
  end if;

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
            'production.settlements.manage'
          )
      )
    );

  if v_assignee_name is null then
    raise exception 'INTEGRITY_ASSIGNEE_NOT_AVAILABLE';
  end if;

  v_actor:=public.current_staff_user_id();
  if v_actor is null then raise exception 'STAFF_USER_NOT_FOUND'; end if;

  update public.equipment_owner_payment_integrity_events
  set assigned_to=p_assigned_to,
      assigned_at=clock_timestamp()
  where id=v_event.id;

  insert into public.equipment_owner_payment_integrity_actions(
    event_id,action_type,note,reference,acted_by
  ) values(
    v_event.id,'ASSIGNED',btrim(p_note),
    p_assigned_to::text,v_actor
  )
  returning id into v_action_id;

  insert into public.notifications(
    user_id,title,body,type,entity_type,entity_id
  ) values(
    p_assigned_to,
    'Назначен инцидент сверки выплаты',
    'Инцидент '||v_event.id::text||
      ' · приоритет '||v_event.severity||
      ' · срок '||to_char(v_event.due_at,'DD.MM.YYYY HH24:MI'),
    'WARNING',
    'EQUIPMENT_OWNER_PAYMENT_INTEGRITY',
    v_event.id
  );

  return v_action_id;
end
$function$
;

revoke all on function public.assign_equipment_owner_payment_integrity_incident(uuid,uuid,text)
from public,anon,authenticated;
grant execute on function public.assign_equipment_owner_payment_integrity_incident(uuid,uuid,text)
to authenticated;

CREATE OR REPLACE FUNCTION public.rescan_equipment_owner_payment_integrity()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r record;
  v_event public.equipment_owner_payment_integrity_events%rowtype;
  v_actor uuid;
  v_is_interactive boolean:=auth.uid() is not null;
  v_new integer:=0;
  v_reopened integer:=0;
  v_updated integer:=0;
  v_resolved integer:=0;
  v_notifications integer:=0;
  v_title text;
  v_body text;
  v_severity text;
  v_now timestamptz;
begin
  if v_is_interactive then
    perform private.assert_non_partner_staff_context();
    if not(
      public.has_permission('equipment.contracts.manage')
      or public.has_permission('production.settlements.manage')
    ) then raise exception 'PERMISSION_DENIED'; end if;
    v_actor:=public.current_staff_user_id();
    if v_actor is null then raise exception 'STAFF_USER_NOT_FOUND'; end if;
  end if;

  for r in
    select *
    from private.equipment_owner_payment_integrity_rows()
    where integrity_state='ERROR'
  loop
    v_event:=null;
    v_now:=clock_timestamp();
    v_severity:=private.equipment_owner_payment_integrity_severity(r.issue_codes);

    select * into v_event
    from public.equipment_owner_payment_integrity_events e
    where e.entity_type=r.entity_type
      and e.entity_id=r.entity_id
      and e.issue_signature=r.issue_signature
    for update;

    if v_event.id is null then
      insert into public.equipment_owner_payment_integrity_events(
        entity_type,entity_id,contract_id,partner_id,organization_id,
        issue_signature,issue_codes,integrity_snapshot,status,
        detected_at,last_seen_at,occurrence_count,
        severity,due_at,escalation_count
      ) values(
        r.entity_type,r.entity_id,r.contract_id,r.partner_id,r.organization_id,
        r.issue_signature,r.issue_codes,to_jsonb(r),'OPEN',
        v_now,v_now,1,
        v_severity,
        v_now+private.equipment_owner_payment_integrity_sla_interval(v_severity),
        0
      )
      returning * into v_event;

      v_new:=v_new+1;
      v_title:='Нарушение цепочки выплаты владельцу';

    elsif v_event.status='RESOLVED' then
      update public.equipment_owner_payment_integrity_events
      set status='OPEN',
          issue_codes=r.issue_codes,
          integrity_snapshot=to_jsonb(r),
          last_seen_at=v_now,
          resolved_at=null,
          occurrence_count=occurrence_count+1,
          severity=v_severity,
          due_at=v_now+private.equipment_owner_payment_integrity_sla_interval(v_severity),
          last_escalated_at=null,
          escalation_count=0
      where id=v_event.id
      returning * into v_event;

      insert into public.equipment_owner_payment_integrity_actions(
        event_id,action_type,note,reference,acted_by
      ) values(
        v_event.id,'REOPENED',
        'Нарушение повторно обнаружено автоматической сверкой.',
        null,v_actor
      );

      v_reopened:=v_reopened+1;
      v_title:='Повторное нарушение цепочки выплаты владельцу';

    else
      update public.equipment_owner_payment_integrity_events
      set issue_codes=r.issue_codes,
          integrity_snapshot=to_jsonb(r),
          last_seen_at=v_now,
          occurrence_count=occurrence_count+1
      where id=v_event.id
      returning * into v_event;

      v_updated:=v_updated+1;
      continue;
    end if;

    v_body:=coalesce(r.partner_name,'—')||
      ' · договор '||coalesce(r.contract_number,'—')||
      ' · '||v_event.severity||
      ' · до '||to_char(v_event.due_at,'DD.MM.YYYY HH24:MI')||
      ' · '||array_to_string(r.issue_codes,', ');

    insert into public.notifications(
      user_id,title,body,type,entity_type,entity_id
    )
    select distinct
      u.id,v_title,v_body,'WARNING',
      'EQUIPMENT_OWNER_PAYMENT_INTEGRITY',v_event.id
    from public.users u
    join public.organization_units ou
      on ou.id=u.organization_unit_id
     and ou.is_active=true
     and ou.organization_id=r.organization_id
    join public.user_roles ur on ur.user_id=u.id
    join public.roles ro on ro.id=ur.role_id
    left join public.role_permissions rp on rp.role_id=ro.id
    left join public.permissions pp on pp.id=rp.permission_id
    where u.is_active=true
      and (
        ro.name='ADMIN'
        or pp.code in(
          'production.settlements.manage',
          'equipment.contracts.manage'
        )
      );

    v_notifications:=v_notifications+1;
  end loop;

  for v_event in
    select e.*
    from public.equipment_owner_payment_integrity_events e
    where e.status in ('OPEN','ACKNOWLEDGED')
      and not exists(
        select 1
        from private.equipment_owner_payment_integrity_rows() current_row
        where current_row.entity_type=e.entity_type
          and current_row.entity_id=e.entity_id
          and current_row.integrity_state='ERROR'
          and current_row.issue_signature=e.issue_signature
      )
    for update
  loop
    update public.equipment_owner_payment_integrity_events
    set status='RESOLVED',
        resolved_at=clock_timestamp(),
        last_seen_at=clock_timestamp()
    where id=v_event.id;

    insert into public.equipment_owner_payment_integrity_actions(
      event_id,action_type,note,reference,acted_by
    ) values(
      v_event.id,'RESOLVED',
      'Автоматически закрыто после успешной повторной сверки.',
      'AUTO_RECONCILIATION_OK',v_actor
    );

    v_resolved:=v_resolved+1;
  end loop;

  return jsonb_build_object(
    'new',v_new,
    'reopened',v_reopened,
    'updated',v_updated,
    'auto_resolved',v_resolved,
    'notifications',v_notifications,
    'scanned_at',clock_timestamp()
  );
end
$function$
;

revoke all on function public.rescan_equipment_owner_payment_integrity()
from public,anon,authenticated;
grant execute on function public.rescan_equipment_owner_payment_integrity()
to authenticated;

CREATE OR REPLACE FUNCTION public.list_equipment_owner_payment_integrity_incidents(p_include_resolved boolean DEFAULT false)
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
    public.has_permission('equipment.view')
    or public.has_permission('equipment.contracts.manage')
    or public.has_permission('production.settlements.view')
    or public.has_permission('production.settlements.manage')
  ) then raise exception 'PERMISSION_DENIED'; end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by
    case x.severity
      when 'CRITICAL' then 0
      when 'HIGH' then 1
      when 'MEDIUM' then 2
      else 3
    end,
    x.is_overdue desc,
    case x.status when 'OPEN' then 0 when 'ACKNOWLEDGED' then 1 else 2 end,
    x.due_at
  ),'[]'::jsonb)
  into v_result
  from (
    select
      e.id event_id,
      e.entity_type,
      e.entity_id,
      e.contract_id,
      e.partner_id,
      e.organization_id,
      c.contract_number,
      coalesce(nullif(p.legal_name,''),nullif(p.name,''),'Владелец') partner_name,
      e.issue_signature,
      e.issue_codes,
      e.status,
      e.severity,
      e.due_at,
      (e.status<>'RESOLVED' and e.due_at<clock_timestamp()) is_overdue,
      e.assigned_to,
      assignee.full_name assigned_to_name,
      e.assigned_at,
      e.last_escalated_at,
      e.escalation_count,
      e.detected_at first_seen_at,
      e.last_seen_at,
      e.resolved_at,
      e.occurrence_count,
      e.integrity_snapshot,
      a.action_type latest_action,
      a.note latest_note,
      a.reference latest_reference,
      a.acted_at latest_action_at,
      u.full_name latest_action_by,
      coalesce(cr.integrity_state,'OK') current_integrity_state,
      coalesce(cr.issue_codes,'{}'::text[]) current_issue_codes,
      coalesce(cr.issue_signature=e.issue_signature,false) current_signature_matches
    from public.equipment_owner_payment_integrity_events e
    join public.equipment_contracts c on c.id=e.contract_id
    join public.partners p on p.id=e.partner_id
    left join public.users assignee on assignee.id=e.assigned_to
    left join private.equipment_owner_payment_integrity_rows() cr
      on cr.entity_type=e.entity_type
     and cr.entity_id=e.entity_id
    left join lateral(
      select ia.action_type,ia.note,ia.reference,ia.acted_at,ia.acted_by
      from public.equipment_owner_payment_integrity_actions ia
      where ia.event_id=e.id
      order by ia.event_sequence desc
      limit 1
    ) a on true
    left join public.users u on u.id=a.acted_by
    where e.organization_id=v_org
      and (
        coalesce(p_include_resolved,false)
        or e.status<>'RESOLVED'
      )
  ) x;

  return v_result;
end
$function$
;

revoke all on function public.list_equipment_owner_payment_integrity_incidents(boolean)
from public,anon,authenticated;
grant execute on function public.list_equipment_owner_payment_integrity_incidents(boolean)
to authenticated;

CREATE OR REPLACE FUNCTION public.escalate_equipment_owner_payment_integrity_incidents()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  e public.equipment_owner_payment_integrity_events%rowtype;
  v_count integer:=0;
  v_body text;
begin
  for e in
    select *
    from public.equipment_owner_payment_integrity_events
    where status in ('OPEN','ACKNOWLEDGED')
      and due_at<clock_timestamp()
      and (
        last_escalated_at is null
        or last_escalated_at<clock_timestamp()-interval '12 hours'
      )
    order by due_at
    for update skip locked
  loop
    update public.equipment_owner_payment_integrity_events
    set last_escalated_at=clock_timestamp(),
        escalation_count=escalation_count+1
    where id=e.id;

    insert into public.equipment_owner_payment_integrity_actions(
      event_id,action_type,note,reference,acted_by
    ) values(
      e.id,'ESCALATED',
      'SLA инцидента просрочен. Требуется приоритетная проверка.',
      e.severity,null
    );

    v_body:='Инцидент '||e.id::text||
      ' · '||e.severity||
      ' · срок '||to_char(e.due_at,'DD.MM.YYYY HH24:MI')||
      ' · просрочка';

    insert into public.notifications(
      user_id,title,body,type,entity_type,entity_id
    )
    select distinct
      u.id,
      'Просрочен SLA сверки выплаты',
      v_body,
      'WARNING',
      'EQUIPMENT_OWNER_PAYMENT_INTEGRITY',
      e.id
    from public.users u
    join public.organization_units ou
      on ou.id=u.organization_unit_id
     and ou.is_active=true
     and ou.organization_id=e.organization_id
    where u.is_active=true
      and (
        u.id=e.assigned_to
        or exists(
          select 1
          from public.user_roles ur
          join public.roles ro on ro.id=ur.role_id
          left join public.role_permissions rp on rp.role_id=ro.id
          left join public.permissions p on p.id=rp.permission_id
          where ur.user_id=u.id
            and (
              ro.name='ADMIN'
              or p.code in(
                'production.settlements.manage',
                'equipment.contracts.manage'
              )
            )
        )
      );

    v_count:=v_count+1;
  end loop;

  return v_count;
end
$function$
;

revoke all on function public.escalate_equipment_owner_payment_integrity_incidents()
from public,anon,authenticated;

do $$
declare
  v_job bigint;
begin
  select jobid into v_job
  from cron.job
  where jobname='equipment-owner-payment-integrity-escalation-hourly'
  order by jobid
  limit 1;

  if v_job is not null then
    perform cron.unschedule(v_job);
  end if;

  perform cron.schedule(
    'equipment-owner-payment-integrity-escalation-hourly',
    '15 * * * *',
    'select public.escalate_equipment_owner_payment_integrity_incidents();'
  );
end
$$;

select private.assert_production_farm_security_baseline();
