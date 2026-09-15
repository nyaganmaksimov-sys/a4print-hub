-- A4PRINT HUB: Production Farm Phase 17 — partner acknowledgements and disputes.

create table if not exists public.equipment_partner_responses (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete restrict,
  partner_user_id uuid not null references public.partner_users(id) on delete restrict,
  entity_type text not null check(entity_type in ('OWNER_SETTLEMENT','LEASE_CHARGE','CONTRACT_DOCUMENT')),
  entity_id uuid not null,
  response_status text not null check(response_status in ('ACKNOWLEDGED','DISPUTED')),
  comment text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null,
  resolution_note text,
  check(response_status<>'DISPUTED' or nullif(btrim(coalesce(comment,'')),'') is not null)
);

create index if not exists equipment_partner_responses_partner_entity_idx
  on public.equipment_partner_responses(partner_id,entity_type,entity_id,created_at desc);
create index if not exists equipment_partner_responses_unresolved_idx
  on public.equipment_partner_responses(response_status,created_at desc)
  where response_status='DISPUTED' and resolved_at is null;
create index if not exists equipment_partner_responses_partner_user_idx
  on public.equipment_partner_responses(partner_user_id,created_at desc);
create index if not exists equipment_partner_responses_resolved_by_idx
  on public.equipment_partner_responses(resolved_by) where resolved_by is not null;

alter table public.equipment_partner_responses enable row level security;
drop policy if exists equipment_partner_responses_read on public.equipment_partner_responses;
create policy equipment_partner_responses_read on public.equipment_partner_responses
for select to authenticated
using(
  partner_id=public.current_partner_id()
  or public.has_permission('production.settlements.view')
  or public.has_permission('production.settlements.manage')
  or public.has_permission('equipment.contracts.manage')
);

revoke all on public.equipment_partner_responses from public,anon,authenticated;
grant select on public.equipment_partner_responses to authenticated;

drop trigger if exists trg_audit_equipment_partner_responses on public.equipment_partner_responses;
create trigger trg_audit_equipment_partner_responses
after insert or update or delete on public.equipment_partner_responses
for each row execute function public.audit_row_change();

create or replace function public.submit_equipment_partner_response(
  p_entity_type text,
  p_entity_id uuid,
  p_response_status text,
  p_comment text default null
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_partner_id uuid;
  v_partner_user_id uuid;
  v_type text:=upper(btrim(coalesce(p_entity_type,'')));
  v_status text:=upper(btrim(coalesce(p_response_status,'')));
  v_id uuid;
  v_last_status text;
  v_label text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  v_partner_id:=public.current_partner_id();
  v_partner_user_id:=public.current_partner_user_id();
  if v_partner_id is null or v_partner_user_id is null then raise exception 'PARTNER_ACCESS_REQUIRED'; end if;
  if p_entity_id is null then raise exception 'ENTITY_REQUIRED'; end if;
  if v_type not in ('OWNER_SETTLEMENT','LEASE_CHARGE','CONTRACT_DOCUMENT') then raise exception 'INVALID_ENTITY_TYPE'; end if;
  if v_status not in ('ACKNOWLEDGED','DISPUTED') then raise exception 'INVALID_RESPONSE_STATUS'; end if;
  if v_status='DISPUTED' and nullif(btrim(coalesce(p_comment,'')),'') is null then raise exception 'DISPUTE_COMMENT_REQUIRED'; end if;

  if v_type='OWNER_SETTLEMENT' then
    select 'Расчёт по договору '||c.contract_number||' за '||to_char(s.period_start,'DD.MM.YYYY')||'–'||to_char(s.period_end,'DD.MM.YYYY')
      into v_label
      from public.equipment_owner_settlements s
      join public.equipment_contracts c on c.id=s.contract_id
     where s.id=p_entity_id and s.partner_id=v_partner_id and c.partner_id=v_partner_id and s.status in ('APPROVED','PAID');
  elsif v_type='LEASE_CHARGE' then
    select 'Арендное начисление по договору '||c.contract_number||' за '||to_char(lc.period_start,'DD.MM.YYYY')||'–'||to_char(lc.period_end,'DD.MM.YYYY')
      into v_label
      from public.equipment_lease_charges lc
      join public.equipment_contracts c on c.id=lc.contract_id
     where lc.id=p_entity_id and lc.partner_id=v_partner_id and c.partner_id=v_partner_id and lc.status in ('APPROVED','PAID');
  else
    select dt.name||' '||coalesce(d.document_number,'')
      into v_label
      from public.documents d
      join public.document_types dt on dt.id=d.document_type_id
      join public.document_links pl on pl.document_id=d.id and pl.entity_type='PARTNER' and pl.entity_id=v_partner_id
      join public.document_links cl on cl.document_id=d.id and cl.entity_type='EQUIPMENT_CONTRACT'
      join public.equipment_contracts c on c.id=cl.entity_id and c.partner_id=v_partner_id
     where d.id=p_entity_id
       and dt.code in ('EQ_ACCEPTANCE_ACT','EQ_ASSET_LIST','EQ_TERMS_APPENDIX','EQ_RETURN_ACT','EQ_RECONCILIATION_ACT')
       and d.status in ('APPROVED','SIGNED','ACTIVE','TERMINATED','ARCHIVED')
     limit 1;
  end if;
  if v_label is null then raise exception 'ENTITY_NOT_AVAILABLE'; end if;

  select response_status into v_last_status
    from public.equipment_partner_responses
   where partner_id=v_partner_id and entity_type=v_type and entity_id=p_entity_id
   order by created_at desc limit 1;
  if v_last_status=v_status then raise exception 'RESPONSE_ALREADY_CURRENT'; end if;

  insert into public.equipment_partner_responses(partner_id,partner_user_id,entity_type,entity_id,response_status,comment)
  values(v_partner_id,v_partner_user_id,v_type,p_entity_id,v_status,nullif(btrim(coalesce(p_comment,'')),''))
  returning id into v_id;

  if v_status='DISPUTED' then
    insert into public.notifications(user_id,title,body,type,entity_type,entity_id)
    select distinct u.id,'Расхождение от владельца оборудования',coalesce(v_label,'Документ/расчёт')||': '||btrim(p_comment),
           'WARNING','EQUIPMENT_PARTNER_RESPONSE',v_id
      from public.users u
      join public.user_roles ur on ur.user_id=u.id
      join public.roles r on r.id=ur.role_id
      left join public.role_permissions rp on rp.role_id=r.id
      left join public.permissions pp on pp.id=rp.permission_id
     where u.is_active=true and (r.name='ADMIN' or pp.code in ('production.settlements.manage','equipment.contracts.manage'));
  end if;
  return v_id;
end
$$;
revoke all on function public.submit_equipment_partner_response(text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.submit_equipment_partner_response(text,uuid,text,text) to authenticated;

create or replace function public.get_my_equipment_partner_responses()
returns jsonb
language plpgsql
security definer
stable
set search_path=''
as $$
declare
  v_partner_id uuid;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  v_partner_id:=public.current_partner_id();
  if v_partner_id is null then raise exception 'PARTNER_ACCESS_REQUIRED'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'entity_type',r.entity_type,'entity_id',r.entity_id,
    'response_status',r.response_status,'comment',r.comment,'created_at',r.created_at,
    'resolved_at',r.resolved_at,'resolution_note',r.resolution_note
  ) order by r.created_at desc),'[]'::jsonb)
  into v_result
  from public.equipment_partner_responses r
  where r.partner_id=v_partner_id;
  return v_result;
end
$$;
revoke all on function public.get_my_equipment_partner_responses() from public,anon,authenticated;
grant execute on function public.get_my_equipment_partner_responses() to authenticated;

create or replace function public.list_equipment_partner_disputes(p_include_resolved boolean default false)
returns jsonb
language plpgsql
security definer
stable
set search_path=''
as $$
declare
  v_result jsonb;
begin
  if not (public.has_permission('production.settlements.view') or public.has_permission('production.settlements.manage') or public.has_permission('equipment.contracts.manage')) then raise exception 'PERMISSION_DENIED'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'partner_id',r.partner_id,'partner_name',coalesce(p.legal_name,p.name),
    'partner_user_id',r.partner_user_id,'partner_user_name',pu.full_name,
    'entity_type',r.entity_type,'entity_id',r.entity_id,'response_status',r.response_status,
    'comment',r.comment,'created_at',r.created_at,'resolved_at',r.resolved_at,
    'resolution_note',r.resolution_note
  ) order by (r.resolved_at is null) desc,r.created_at desc),'[]'::jsonb)
  into v_result
  from public.equipment_partner_responses r
  join public.partners p on p.id=r.partner_id
  join public.partner_users pu on pu.id=r.partner_user_id
  where r.response_status='DISPUTED' and (coalesce(p_include_resolved,false) or r.resolved_at is null);
  return v_result;
end
$$;
revoke all on function public.list_equipment_partner_disputes(boolean) from public,anon,authenticated;
grant execute on function public.list_equipment_partner_disputes(boolean) to authenticated;

create or replace function public.resolve_equipment_partner_dispute(p_response_id uuid,p_resolution_note text)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=public.current_staff_user_id();
  v_row public.equipment_partner_responses%rowtype;
begin
  if not (public.has_permission('production.settlements.manage') or public.has_permission('equipment.contracts.manage')) then raise exception 'PERMISSION_DENIED'; end if;
  if nullif(btrim(coalesce(p_resolution_note,'')),'') is null then raise exception 'RESOLUTION_NOTE_REQUIRED'; end if;
  select * into v_row from public.equipment_partner_responses where id=p_response_id for update;
  if v_row.id is null then raise exception 'RESPONSE_NOT_FOUND'; end if;
  if v_row.response_status<>'DISPUTED' then raise exception 'NOT_A_DISPUTE'; end if;
  if v_row.resolved_at is not null then raise exception 'DISPUTE_ALREADY_RESOLVED'; end if;
  update public.equipment_partner_responses
     set resolved_at=clock_timestamp(),resolved_by=v_actor,resolution_note=btrim(p_resolution_note)
   where id=v_row.id;
  return v_row.id;
end
$$;
revoke all on function public.resolve_equipment_partner_dispute(uuid,text) from public,anon,authenticated;
grant execute on function public.resolve_equipment_partner_dispute(uuid,text) to authenticated;
