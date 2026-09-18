-- A4PRINT HUB: Production Farm Phase 31 — integrity incident investigation and resolution.

create table if not exists public.equipment_claim_financial_integrity_actions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.equipment_condition_claim_financial_integrity_events(id) on delete restrict,
  action_type text not null check(action_type in ('ACKNOWLEDGED','INVESTIGATING','RESOLVED','REOPENED')),
  note text not null check(length(btrim(note))>=3),
  reference text,
  acted_by uuid references public.users(id) on delete restrict,
  acted_at timestamptz not null default clock_timestamp(),
  event_sequence bigint generated always as identity,
  constraint equipment_claim_financial_integrity_actions_resolution_reference
    check(action_type<>'RESOLVED' or length(btrim(coalesce(reference,'')))>=2)
);

create index if not exists equipment_claim_financial_integrity_actions_event_idx
  on public.equipment_claim_financial_integrity_actions(event_id,event_sequence desc);

alter table public.equipment_claim_financial_integrity_actions enable row level security;
drop policy if exists equipment_claim_financial_integrity_actions_staff_read
  on public.equipment_claim_financial_integrity_actions;
create policy equipment_claim_financial_integrity_actions_staff_read
on public.equipment_claim_financial_integrity_actions
for select to authenticated
using(
  public.has_permission('equipment.view')
  or public.has_permission('equipment.contracts.manage')
  or public.has_permission('production.settlements.view')
  or public.has_permission('production.settlements.manage')
);
revoke all on public.equipment_claim_financial_integrity_actions from public,anon,authenticated;
grant select on public.equipment_claim_financial_integrity_actions to authenticated;

create or replace function public.guard_equipment_claim_integrity_action_append_only()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  raise exception 'CLAIM_FINANCIAL_INTEGRITY_ACTION_APPEND_ONLY';
end
$$;
revoke all on function public.guard_equipment_claim_integrity_action_append_only() from public,anon,authenticated;

drop trigger if exists trg_guard_equipment_claim_integrity_action_append_only
  on public.equipment_claim_financial_integrity_actions;
create trigger trg_guard_equipment_claim_integrity_action_append_only
before update or delete on public.equipment_claim_financial_integrity_actions
for each row execute function public.guard_equipment_claim_integrity_action_append_only();

drop trigger if exists trg_audit_equipment_claim_financial_integrity_actions
  on public.equipment_claim_financial_integrity_actions;
create trigger trg_audit_equipment_claim_financial_integrity_actions
after insert or update or delete on public.equipment_claim_financial_integrity_actions
for each row execute function public.audit_row_change();

create or replace function public.equipment_claim_integrity_signature(
  p_issue_codes text[],
  p_original_transaction_id uuid,
  p_reversal_transaction_id uuid,
  p_repost_transaction_id uuid,
  p_actual_net_effect numeric
)
returns text
language sql
immutable
set search_path=''
as $$
  select md5(
    array_to_string(coalesce(p_issue_codes,'{}'::text[]),'|')||'|'||
    coalesce(p_original_transaction_id::text,'-')||'|'||
    coalesce(p_reversal_transaction_id::text,'-')||'|'||
    coalesce(p_repost_transaction_id::text,'-')||'|'||
    coalesce(p_actual_net_effect::text,'-')
  );
$$;
revoke all on function public.equipment_claim_integrity_signature(text[],uuid,uuid,uuid,numeric)
  from public,anon,authenticated;

create or replace function public.list_equipment_claim_integrity_incidents(
  p_include_resolved boolean default false
)
returns table(
  event_id uuid,
  claim_id uuid,
  partner_name text,
  contract_number text,
  inventory_number text,
  equipment_name text,
  detected_at timestamptz,
  event_issue_codes text[],
  case_state text,
  latest_note text,
  latest_reference text,
  latest_at timestamptz,
  latest_by_name text,
  current_integrity_state text,
  current_issue_codes text[],
  current_signature_matches boolean
)
language plpgsql
security definer
stable
set search_path=''
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not(
    public.has_permission('equipment.view')
    or public.has_permission('equipment.contracts.manage')
    or public.has_permission('production.settlements.view')
    or public.has_permission('production.settlements.manage')
  ) then raise exception 'PERMISSION_DENIED'; end if;

  return query
  with current_rows as (
    select x.*,
      public.equipment_claim_integrity_signature(
        x.issue_codes,x.original_transaction_id,x.reversal_transaction_id,x.repost_transaction_id,x.actual_net_effect
      ) current_signature
    from public.equipment_condition_claim_financial_integrity_rows() x
  ), incident_rows as (
    select
      e.id event_id,e.claim_id,e.detected_at,e.issue_codes event_issue_codes,e.issue_signature,
      coalesce(p.legal_name,p.name)::text partner_name,
      ec.contract_number::text,
      ea.inventory_number::text,
      ea.name::text equipment_name,
      a.action_type latest_action,
      a.note latest_note,
      a.reference latest_reference,
      a.acted_at latest_at,
      u.full_name::text latest_by_name,
      coalesce(cr.integrity_state,'OK')::text current_integrity_state,
      coalesce(cr.issue_codes,'{}'::text[]) current_issue_codes,
      coalesce(cr.current_signature=e.issue_signature,false) current_signature_matches
    from public.equipment_condition_claim_financial_integrity_events e
    join public.equipment_condition_claims c on c.id=e.claim_id
    join public.partners p on p.id=c.partner_id
    join public.equipment_contracts ec on ec.id=c.contract_id
    join public.equipment_assets ea on ea.id=c.equipment_id
    left join current_rows cr on cr.claim_id=e.claim_id
    left join lateral(
      select ia.action_type,ia.note,ia.reference,ia.acted_at,ia.acted_by
      from public.equipment_claim_financial_integrity_actions ia
      where ia.event_id=e.id
      order by ia.event_sequence desc
      limit 1
    ) a on true
    left join public.users u on u.id=a.acted_by
  )
  select
    i.event_id,i.claim_id,i.partner_name,i.contract_number,i.inventory_number,i.equipment_name,
    i.detected_at,i.event_issue_codes,
    case
      when i.latest_action='RESOLVED' and i.current_signature_matches then 'REOPENED'
      else coalesce(i.latest_action,'OPEN')
    end::text case_state,
    i.latest_note,i.latest_reference,i.latest_at,i.latest_by_name,
    i.current_integrity_state,i.current_issue_codes,i.current_signature_matches
  from incident_rows i
  where coalesce(p_include_resolved,false)
     or (
       case
         when i.latest_action='RESOLVED' and i.current_signature_matches then 'REOPENED'
         else coalesce(i.latest_action,'OPEN')
       end
     )<>'RESOLVED'
  order by
    case (
      case
        when i.latest_action='RESOLVED' and i.current_signature_matches then 'REOPENED'
        else coalesce(i.latest_action,'OPEN')
      end
    )
      when 'REOPENED' then 0
      when 'OPEN' then 1
      when 'INVESTIGATING' then 2
      when 'ACKNOWLEDGED' then 3
      else 4
    end,
    i.detected_at desc;
end
$$;
revoke all on function public.list_equipment_claim_integrity_incidents(boolean) from public,anon,authenticated;
grant execute on function public.list_equipment_claim_integrity_incidents(boolean) to authenticated;

create or replace function public.set_equipment_claim_integrity_incident_state(
  p_event_id uuid,
  p_state text,
  p_note text,
  p_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_event public.equipment_condition_claim_financial_integrity_events%rowtype;
  v_current record;
  v_current_signature text;
  v_latest text;
  v_derived text;
  v_actor uuid;
  v_action_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not(
    public.has_permission('equipment.contracts.manage')
    or public.has_permission('production.settlements.manage')
  ) then raise exception 'PERMISSION_DENIED'; end if;
  if p_event_id is null then raise exception 'INTEGRITY_EVENT_REQUIRED'; end if;
  if p_state not in ('ACKNOWLEDGED','INVESTIGATING','RESOLVED') then
    raise exception 'INTEGRITY_INCIDENT_STATE_INVALID';
  end if;
  if nullif(btrim(coalesce(p_note,'')),'') is null or length(btrim(p_note))<3 then
    raise exception 'INTEGRITY_INCIDENT_NOTE_REQUIRED';
  end if;
  if p_state='RESOLVED'
     and (nullif(btrim(coalesce(p_reference,'')),'') is null or length(btrim(p_reference))<2)
  then raise exception 'INTEGRITY_RESOLUTION_REFERENCE_REQUIRED'; end if;

  select * into v_event
  from public.equipment_condition_claim_financial_integrity_events
  where id=p_event_id
  for update;
  if v_event.id is null then raise exception 'INTEGRITY_EVENT_NOT_FOUND'; end if;

  select * into v_current
  from public.equipment_condition_claim_financial_integrity_rows() x
  where x.claim_id=v_event.claim_id;
  if found then
    v_current_signature:=public.equipment_claim_integrity_signature(
      v_current.issue_codes,
      v_current.original_transaction_id,
      v_current.reversal_transaction_id,
      v_current.repost_transaction_id,
      v_current.actual_net_effect
    );
  end if;

  select a.action_type into v_latest
  from public.equipment_claim_financial_integrity_actions a
  where a.event_id=v_event.id
  order by a.event_sequence desc
  limit 1;

  v_derived:=case
    when v_latest='RESOLVED' and coalesce(v_current_signature=v_event.issue_signature,false) then 'REOPENED'
    else coalesce(v_latest,'OPEN')
  end;

  if v_derived=p_state then raise exception 'INTEGRITY_INCIDENT_STATE_ALREADY_CURRENT'; end if;
  if p_state='RESOLVED' and coalesce(v_current_signature=v_event.issue_signature,false) then
    raise exception 'INTEGRITY_ISSUE_STILL_ACTIVE';
  end if;

  v_actor:=public.current_staff_user_id();
  if v_actor is null then raise exception 'STAFF_USER_NOT_FOUND'; end if;

  insert into public.equipment_claim_financial_integrity_actions(
    event_id,action_type,note,reference,acted_by
  ) values(
    v_event.id,p_state,btrim(p_note),nullif(btrim(coalesce(p_reference,'')),''),v_actor
  )
  returning id into v_action_id;

  return v_action_id;
end
$$;
revoke all on function public.set_equipment_claim_integrity_incident_state(uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function public.set_equipment_claim_integrity_incident_state(uuid,text,text,text)
  to authenticated;

create or replace function public.emit_equipment_claim_financial_integrity_notifications()
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  r record;
  v_signature text;
  v_event_id uuid;
  v_inserted boolean;
  v_count integer:=0;
  v_title text;
  v_body text;
  v_latest text;
begin
  for r in
    select * from public.equipment_condition_claim_financial_integrity_rows()
    where integrity_state='ERROR'
  loop
    v_signature:=public.equipment_claim_integrity_signature(
      r.issue_codes,r.original_transaction_id,r.reversal_transaction_id,r.repost_transaction_id,r.actual_net_effect
    );
    v_event_id:=null;
    v_inserted:=false;
    v_latest:=null;

    insert into public.equipment_condition_claim_financial_integrity_events(claim_id,issue_signature,issue_codes)
    values(r.claim_id,v_signature,r.issue_codes)
    on conflict(claim_id,issue_signature) do nothing
    returning id into v_event_id;

    if v_event_id is not null then
      v_inserted:=true;
    else
      select e.id into v_event_id
      from public.equipment_condition_claim_financial_integrity_events e
      where e.claim_id=r.claim_id and e.issue_signature=v_signature;

      select a.action_type into v_latest
      from public.equipment_claim_financial_integrity_actions a
      where a.event_id=v_event_id
      order by a.event_sequence desc
      limit 1;

      if v_latest='RESOLVED' then
        insert into public.equipment_claim_financial_integrity_actions(
          event_id,action_type,note,reference,acted_by
        ) values(
          v_event_id,'REOPENED','Повторно обнаружено автоматическим контролем.',null,null
        );
        v_inserted:=true;
      end if;
    end if;

    if not v_inserted then continue; end if;
    v_count:=v_count+1;
    v_title:=case
      when v_latest='RESOLVED' then 'Повторное нарушение финансовой цепочки'
      else 'Нарушение финансовой цепочки требования'
    end;
    v_body:=coalesce(r.partner_name,'—')||
      ' · договор '||coalesce(r.contract_number,'—')||
      ' · '||coalesce(r.inventory_number,'—')||
      ' · '||array_to_string(r.issue_codes,', ');

    insert into public.notifications(user_id,title,body,type,entity_type,entity_id)
    select distinct
      u.id,v_title,v_body,'WARNING','EQUIPMENT_CLAIM_FINANCIAL_INTEGRITY',v_event_id
    from public.users u
    join public.user_roles ur on ur.user_id=u.id
    join public.roles ro on ro.id=ur.role_id
    left join public.role_permissions rp on rp.role_id=ro.id
    left join public.permissions pp on pp.id=rp.permission_id
    where u.is_active=true
      and (ro.name='ADMIN' or pp.code in ('production.settlements.manage','equipment.contracts.manage'));
  end loop;
  return v_count;
end
$$;
revoke all on function public.emit_equipment_claim_financial_integrity_notifications()
  from public,anon,authenticated;
