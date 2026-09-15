-- Phase 17 hardening: deterministic append-only event order inside one transaction.
alter table public.equipment_partner_responses
  add column if not exists event_sequence bigint generated always as identity;
create unique index if not exists equipment_partner_responses_event_sequence_idx
  on public.equipment_partner_responses(event_sequence);

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
   order by event_sequence desc limit 1;
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
    'id',r.id,'event_sequence',r.event_sequence,'entity_type',r.entity_type,'entity_id',r.entity_id,
    'response_status',r.response_status,'comment',r.comment,'created_at',r.created_at,
    'resolved_at',r.resolved_at,'resolution_note',r.resolution_note
  ) order by r.event_sequence desc),'[]'::jsonb)
  into v_result
  from public.equipment_partner_responses r
  where r.partner_id=v_partner_id;
  return v_result;
end
$$;

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
    'id',r.id,'event_sequence',r.event_sequence,'partner_id',r.partner_id,'partner_name',coalesce(p.legal_name,p.name),
    'partner_user_id',r.partner_user_id,'partner_user_name',pu.full_name,'entity_type',r.entity_type,'entity_id',r.entity_id,
    'response_status',r.response_status,'comment',r.comment,'created_at',r.created_at,
    'resolved_at',r.resolved_at,'resolution_note',r.resolution_note
  ) order by (r.resolved_at is null) desc,r.event_sequence desc),'[]'::jsonb)
  into v_result
  from public.equipment_partner_responses r
  join public.partners p on p.id=r.partner_id
  join public.partner_users pu on pu.id=r.partner_user_id
  where r.response_status='DISPUTED' and (coalesce(p_include_resolved,false) or r.resolved_at is null);
  return v_result;
end
$$;
