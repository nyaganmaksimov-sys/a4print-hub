-- A4PRINT HUB: Production Farm Phase 24 — compare acceptance vs return condition without automatic liability or charges.

insert into public.document_types(name,code,description,requires_signature,default_validity_days)
select 'Сверка состояния оборудования','EQ_CONDITION_COMPARISON','Сравнение состояния оборудования между приёмкой и возвратом без автоматического определения ответственности',false,null
where not exists(select 1 from public.document_types where code='EQ_CONDITION_COMPARISON');

create table if not exists public.equipment_condition_comparisons (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.equipment_contracts(id) on delete restrict,
  equipment_id uuid not null references public.equipment_assets(id) on delete restrict,
  partner_id uuid not null references public.partners(id) on delete restrict,
  termination_id uuid references public.equipment_contract_terminations(id) on delete restrict,
  acceptance_inspection_id uuid references public.equipment_condition_inspections(id) on delete restrict,
  return_inspection_id uuid not null unique references public.equipment_condition_inspections(id) on delete restrict,
  comparison_status text not null check(comparison_status in ('NO_BASELINE','NO_DISCREPANCY','OPEN','RESOLVED')),
  material_change boolean not null default false,
  delta_snapshot jsonb not null default '{}'::jsonb,
  document_id uuid unique references public.documents(id) on delete restrict,
  resolution_code text check(resolution_code is null or resolution_code in ('NORMAL_WEAR','HUB_RESPONSIBILITY','OWNER_RESPONSIBILITY','SHARED','NO_CLAIM','OTHER')),
  resolution_note text,
  resolved_by uuid references public.users(id) on delete set null,
  resolved_at timestamptz,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index if not exists equipment_condition_comparisons_partner_idx on public.equipment_condition_comparisons(partner_id,created_at desc);
create index if not exists equipment_condition_comparisons_contract_idx on public.equipment_condition_comparisons(contract_id,created_at desc);
create index if not exists equipment_condition_comparisons_equipment_idx on public.equipment_condition_comparisons(equipment_id,created_at desc);
create index if not exists equipment_condition_comparisons_status_idx on public.equipment_condition_comparisons(comparison_status,created_at desc);
create index if not exists equipment_condition_comparisons_termination_idx on public.equipment_condition_comparisons(termination_id) where termination_id is not null;

create table if not exists public.equipment_condition_comparison_responses (
  id uuid primary key default gen_random_uuid(),
  comparison_id uuid not null references public.equipment_condition_comparisons(id) on delete restrict,
  partner_id uuid not null references public.partners(id) on delete restrict,
  partner_user_id uuid not null references public.partner_users(id) on delete restrict,
  response_status text not null check(response_status in ('ACKNOWLEDGED','DISPUTED')),
  comment text,
  event_sequence bigint generated always as identity,
  created_at timestamptz not null default clock_timestamp(),
  check(response_status<>'DISPUTED' or nullif(btrim(coalesce(comment,'')),'') is not null)
);
create index if not exists equipment_condition_comparison_responses_case_idx on public.equipment_condition_comparison_responses(comparison_id,event_sequence desc);
create index if not exists equipment_condition_comparison_responses_partner_idx on public.equipment_condition_comparison_responses(partner_id,event_sequence desc);

alter table public.equipment_condition_comparisons enable row level security;
alter table public.equipment_condition_comparison_responses enable row level security;

drop policy if exists equipment_condition_comparisons_read on public.equipment_condition_comparisons;
create policy equipment_condition_comparisons_read on public.equipment_condition_comparisons for select to authenticated
using(
  public.has_permission('equipment.view') or public.has_permission('equipment.manage') or public.has_permission('equipment.contracts.manage')
  or partner_id=public.current_partner_id()
);

drop policy if exists equipment_condition_comparison_responses_read on public.equipment_condition_comparison_responses;
create policy equipment_condition_comparison_responses_read on public.equipment_condition_comparison_responses for select to authenticated
using(
  public.has_permission('equipment.view') or public.has_permission('equipment.manage') or public.has_permission('equipment.contracts.manage')
  or partner_id=public.current_partner_id()
);

revoke all on public.equipment_condition_comparisons from public,anon,authenticated;
revoke all on public.equipment_condition_comparison_responses from public,anon,authenticated;
grant select on public.equipment_condition_comparisons to authenticated;
grant select on public.equipment_condition_comparison_responses to authenticated;

drop trigger if exists trg_equipment_condition_comparisons_updated_at on public.equipment_condition_comparisons;
create trigger trg_equipment_condition_comparisons_updated_at before update on public.equipment_condition_comparisons for each row execute function public.touch_production_farm_updated_at();
drop trigger if exists trg_audit_equipment_condition_comparisons on public.equipment_condition_comparisons;
create trigger trg_audit_equipment_condition_comparisons after insert or update or delete on public.equipment_condition_comparisons for each row execute function public.audit_row_change();
drop trigger if exists trg_audit_equipment_condition_comparison_responses on public.equipment_condition_comparison_responses;
create trigger trg_audit_equipment_condition_comparison_responses after insert or update or delete on public.equipment_condition_comparison_responses for each row execute function public.audit_row_change();

create or replace function public.equipment_condition_grade_rank(p_grade text)
returns integer language sql immutable set search_path='' as $$
  select case upper(coalesce(p_grade,'')) when 'EXCELLENT' then 5 when 'GOOD' then 4 when 'FAIR' then 3 when 'POOR' then 2 when 'NON_OPERATIONAL' then 1 else 0 end
$$;
revoke all on function public.equipment_condition_grade_rank(text) from public,anon,authenticated;

create or replace function public.equipment_operational_state_rank(p_state text)
returns integer language sql immutable set search_path='' as $$
  select case upper(coalesce(p_state,'')) when 'READY' then 3 when 'LIMITED' then 2 when 'NOT_OPERATIONAL' then 1 else 0 end
$$;
revoke all on function public.equipment_operational_state_rank(text) from public,anon,authenticated;

create or replace function public.build_equipment_condition_delta(p_return_inspection_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_ret public.equipment_condition_inspections%rowtype;
  v_acc public.equipment_condition_inspections%rowtype;
  v_new_issues jsonb:='[]'::jsonb;
  v_new_defects jsonb:='[]'::jsonb;
  v_check_changes jsonb:='[]'::jsonb;
  v_condition_worsened boolean:=false;
  v_operational_worsened boolean:=false;
  v_material boolean:=false;
  v_meter_delta numeric;
begin
  select * into v_ret from public.equipment_condition_inspections
   where id=p_return_inspection_id and inspection_type='RETURN' and status='COMPLETED';
  if v_ret.id is null then raise exception 'COMPLETED_RETURN_INSPECTION_REQUIRED'; end if;

  select * into v_acc
    from public.equipment_condition_inspections
   where contract_id=v_ret.contract_id
     and equipment_id=v_ret.equipment_id
     and inspection_type='ACCEPTANCE'
     and status='COMPLETED'
     and inspected_on<=v_ret.inspected_on
   order by inspected_on desc,completed_at desc nulls last,created_at desc
   limit 1;

  if v_acc.id is null then
    return jsonb_build_object(
      'schema_version',1,'baseline_missing',true,'material_change',false,
      'acceptance_inspection_id',null,'return_inspection_id',v_ret.id,
      'return',jsonb_build_object('inspected_on',v_ret.inspected_on,'condition_grade',v_ret.condition_grade,'operational_state',v_ret.operational_state,'meter_hours',v_ret.meter_hours,'checklist',v_ret.checklist,'defects',v_ret.defects,'document_id',v_ret.document_id)
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'key',coalesce(r.item->>'key',r.item->>'label'),
    'label',coalesce(r.item->>'label',r.item->>'key'),
    'before',coalesce(a.item->>'result',''),
    'after',coalesce(r.item->>'result',''),
    'before_note',a.item->>'note',
    'after_note',r.item->>'note'
  ) order by r.ord),'[]'::jsonb)
  into v_check_changes
  from jsonb_array_elements(v_ret.checklist) with ordinality r(item,ord)
  left join lateral (
    select x.item from jsonb_array_elements(v_acc.checklist) x(item)
     where coalesce(x.item->>'key',x.item->>'label')=coalesce(r.item->>'key',r.item->>'label') limit 1
  ) a on true
  where upper(coalesce(r.item->>'result','')) is distinct from upper(coalesce(a.item->>'result',''));

  select coalesce(jsonb_agg(x),'[]'::jsonb) into v_new_issues
  from jsonb_array_elements(v_check_changes) x
  where upper(coalesce(x->>'after',''))='ISSUE' and upper(coalesce(x->>'before',''))<>'ISSUE';

  select coalesce(jsonb_agg(r.item order by r.ord),'[]'::jsonb)
  into v_new_defects
  from jsonb_array_elements(v_ret.defects) with ordinality r(item,ord)
  where not exists(
    select 1 from jsonb_array_elements(v_acc.defects) a(item)
     where lower(btrim(coalesce(a.item->>'description',a.item->>'text',a.item::text)))=
           lower(btrim(coalesce(r.item->>'description',r.item->>'text',r.item::text)))
  );

  v_condition_worsened:=public.equipment_condition_grade_rank(v_ret.condition_grade)<public.equipment_condition_grade_rank(v_acc.condition_grade);
  v_operational_worsened:=public.equipment_operational_state_rank(v_ret.operational_state)<public.equipment_operational_state_rank(v_acc.operational_state);
  if v_acc.meter_hours is not null and v_ret.meter_hours is not null then v_meter_delta:=v_ret.meter_hours-v_acc.meter_hours; end if;
  v_material:=v_condition_worsened or v_operational_worsened or jsonb_array_length(v_new_issues)>0 or jsonb_array_length(v_new_defects)>0;

  return jsonb_build_object(
    'schema_version',1,'baseline_missing',false,'material_change',v_material,
    'acceptance_inspection_id',v_acc.id,'return_inspection_id',v_ret.id,
    'condition',jsonb_build_object('before',v_acc.condition_grade,'after',v_ret.condition_grade,'worsened',v_condition_worsened),
    'operational_state',jsonb_build_object('before',v_acc.operational_state,'after',v_ret.operational_state,'worsened',v_operational_worsened),
    'meter',jsonb_build_object('before',v_acc.meter_hours,'after',v_ret.meter_hours,'delta',v_meter_delta),
    'checklist_changes',v_check_changes,'new_checklist_issues',v_new_issues,
    'acceptance_defects',v_acc.defects,'return_defects',v_ret.defects,'new_defects',v_new_defects,
    'acceptance',jsonb_build_object('inspected_on',v_acc.inspected_on,'document_id',v_acc.document_id),
    'return',jsonb_build_object('inspected_on',v_ret.inspected_on,'document_id',v_ret.document_id)
  );
end $$;
revoke all on function public.build_equipment_condition_delta(uuid) from public,anon,authenticated;

create or replace function public.guard_equipment_condition_comparison_core()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'CONDITION_COMPARISON_IMMUTABLE'; end if;
  if old.comparison_status='RESOLVED' then raise exception 'RESOLVED_COMPARISON_IMMUTABLE'; end if;
  if row(new.contract_id,new.equipment_id,new.partner_id,new.termination_id,new.acceptance_inspection_id,new.return_inspection_id,new.material_change,new.delta_snapshot,new.created_by,new.created_at)
     is distinct from
     row(old.contract_id,old.equipment_id,old.partner_id,old.termination_id,old.acceptance_inspection_id,old.return_inspection_id,old.material_change,old.delta_snapshot,old.created_by,old.created_at)
  then raise exception 'CONDITION_COMPARISON_CORE_IMMUTABLE'; end if;
  if old.document_id is not null and new.document_id is distinct from old.document_id then raise exception 'CONDITION_COMPARISON_DOCUMENT_IMMUTABLE'; end if;
  return new;
end $$;
revoke all on function public.guard_equipment_condition_comparison_core() from public,anon,authenticated;
drop trigger if exists trg_guard_equipment_condition_comparison_core on public.equipment_condition_comparisons;
create trigger trg_guard_equipment_condition_comparison_core before update or delete on public.equipment_condition_comparisons for each row execute function public.guard_equipment_condition_comparison_core();

create or replace function public.guard_equipment_condition_comparison_response()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'COMPARISON_RESPONSE_APPEND_ONLY';
end $$;
revoke all on function public.guard_equipment_condition_comparison_response() from public,anon,authenticated;
drop trigger if exists trg_guard_equipment_condition_comparison_response on public.equipment_condition_comparison_responses;
create trigger trg_guard_equipment_condition_comparison_response before update or delete on public.equipment_condition_comparison_responses for each row execute function public.guard_equipment_condition_comparison_response();

create or replace function public.ensure_equipment_condition_comparison(p_return_inspection_id uuid)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_ret public.equipment_condition_inspections%rowtype;
  v_delta jsonb;
  v_acc_id uuid;
  v_material boolean;
  v_status text;
  v_actor uuid;
  v_id uuid;
  v_doc_type uuid;
  v_doc uuid;
  v_number text;
  v_title text;
begin
  select * into v_ret from public.equipment_condition_inspections
   where id=p_return_inspection_id and inspection_type='RETURN' and status='COMPLETED';
  if v_ret.id is null then raise exception 'COMPLETED_RETURN_INSPECTION_REQUIRED'; end if;
  select id into v_id from public.equipment_condition_comparisons where return_inspection_id=v_ret.id;
  if v_id is not null then return v_id; end if;

  v_delta:=public.build_equipment_condition_delta(v_ret.id);
  v_acc_id=nullif(v_delta->>'acceptance_inspection_id','')::uuid;
  v_material:=coalesce((v_delta->>'material_change')::boolean,false);
  v_status:=case when coalesce((v_delta->>'baseline_missing')::boolean,false) then 'NO_BASELINE' when v_material then 'OPEN' else 'NO_DISCREPANCY' end;
  v_actor:=coalesce(v_ret.completed_by,public.current_staff_user_id());
  if v_actor is null then raise exception 'STAFF_USER_NOT_FOUND'; end if;

  insert into public.equipment_condition_comparisons(contract_id,equipment_id,partner_id,termination_id,acceptance_inspection_id,return_inspection_id,comparison_status,material_change,delta_snapshot,created_by)
  values(v_ret.contract_id,v_ret.equipment_id,v_ret.partner_id,v_ret.termination_id,v_acc_id,v_ret.id,v_status,v_material,v_delta,v_actor)
  returning id into v_id;

  select id into v_doc_type from public.document_types where code='EQ_CONDITION_COMPARISON';
  if v_doc_type is null then raise exception 'DOCUMENT_TYPE_NOT_FOUND'; end if;
  v_number:='CMP-'||to_char(v_ret.inspected_on,'YYYYMMDD')||'-'||upper(substr(v_id::text,1,8));
  select 'Сверка состояния · '||coalesce(a.inventory_number,a.name,'оборудование') into v_title from public.equipment_assets a where a.id=v_ret.equipment_id;
  insert into public.documents(document_type_id,document_number,title,status,business_unit,issue_date,created_by,metadata,created_at,updated_at)
  values(v_doc_type,v_number,v_title,'ACTIVE'::public.document_status,'COMMON'::public.business_unit,v_ret.inspected_on,v_actor,
    jsonb_build_object('schema_version',1,'comparison_id',v_id,'comparison_status',v_status,'material_change',v_material,'delta',v_delta),clock_timestamp(),clock_timestamp())
  returning id into v_doc;
  update public.equipment_condition_comparisons set document_id=v_doc where id=v_id;

  insert into public.document_links(document_id,entity_type,entity_id,relationship,created_at) values(v_doc,'EQUIPMENT_CONDITION_COMPARISON',v_id,'SOURCE',clock_timestamp()) on conflict do nothing;
  insert into public.document_links(document_id,entity_type,entity_id,relationship,created_at) values(v_doc,'EQUIPMENT_CONDITION_INSPECTION',v_ret.id,'RETURN',clock_timestamp()) on conflict do nothing;
  if v_acc_id is not null then insert into public.document_links(document_id,entity_type,entity_id,relationship,created_at) values(v_doc,'EQUIPMENT_CONDITION_INSPECTION',v_acc_id,'ACCEPTANCE',clock_timestamp()) on conflict do nothing; end if;
  insert into public.document_links(document_id,entity_type,entity_id,relationship,created_at) values(v_doc,'EQUIPMENT_ASSET',v_ret.equipment_id,'CONDITION_COMPARISON',clock_timestamp()) on conflict do nothing;
  insert into public.document_links(document_id,entity_type,entity_id,relationship,created_at) values(v_doc,'EQUIPMENT_CONTRACT',v_ret.contract_id,'CONDITION_COMPARISON',clock_timestamp()) on conflict do nothing;
  insert into public.document_links(document_id,entity_type,entity_id,relationship,created_at) values(v_doc,'PARTNER',v_ret.partner_id,'CONDITION_COMPARISON',clock_timestamp()) on conflict do nothing;
  if v_ret.termination_id is not null then insert into public.document_links(document_id,entity_type,entity_id,relationship,created_at) values(v_doc,'EQUIPMENT_CONTRACT_TERMINATION',v_ret.termination_id,'CONDITION_COMPARISON',clock_timestamp()) on conflict do nothing; end if;

  if v_status='OPEN' then
    insert into public.notifications(user_id,title,body,type,entity_type,entity_id)
    select distinct u.id,'Обнаружены изменения состояния оборудования',v_title||' · требуется сверка','WARNING','EQUIPMENT_CONDITION_COMPARISON',v_id
    from public.users u
    join public.user_roles ur on ur.user_id=u.id
    join public.roles ro on ro.id=ur.role_id
    left join public.role_permissions rp on rp.role_id=ro.id
    left join public.permissions pp on pp.id=rp.permission_id
    where u.is_active=true and (ro.name='ADMIN' or pp.code in ('equipment.manage','equipment.contracts.manage'));
  end if;
  return v_id;
end $$;
revoke all on function public.ensure_equipment_condition_comparison(uuid) from public,anon,authenticated;

create or replace function public.create_equipment_condition_comparison_after_return()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.inspection_type='RETURN' and new.status='COMPLETED' and old.status is distinct from 'COMPLETED' then
    perform public.ensure_equipment_condition_comparison(new.id);
  end if;
  return new;
end $$;
revoke all on function public.create_equipment_condition_comparison_after_return() from public,anon,authenticated;
drop trigger if exists trg_create_equipment_condition_comparison_after_return on public.equipment_condition_inspections;
create trigger trg_create_equipment_condition_comparison_after_return after update of status on public.equipment_condition_inspections for each row execute function public.create_equipment_condition_comparison_after_return();

create or replace function public.list_equipment_condition_comparisons(p_include_resolved boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  if not (public.has_permission('equipment.view') or public.has_permission('equipment.manage') or public.has_permission('equipment.contracts.manage')) then raise exception 'PERMISSION_DENIED'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into v_result
  from (
    select c.id comparison_id,c.comparison_status,c.material_change,c.delta_snapshot,c.resolution_code,c.resolution_note,c.resolved_at,c.created_at,
           c.contract_id,ec.contract_number,c.equipment_id,a.inventory_number,a.name equipment_name,a.brand,a.model,a.serial_number,
           c.partner_id,coalesce(p.legal_name,p.name) partner_name,c.termination_id,c.acceptance_inspection_id,c.return_inspection_id,c.document_id,d.document_number,
           ar.inspected_on acceptance_date,rr.inspected_on return_date,
           lr.response_status partner_response_status,lr.comment partner_response_comment,lr.created_at partner_responded_at
      from public.equipment_condition_comparisons c
      join public.equipment_contracts ec on ec.id=c.contract_id
      join public.equipment_assets a on a.id=c.equipment_id
      join public.partners p on p.id=c.partner_id
      left join public.equipment_condition_inspections ar on ar.id=c.acceptance_inspection_id
      join public.equipment_condition_inspections rr on rr.id=c.return_inspection_id
      left join public.documents d on d.id=c.document_id
      left join lateral (
        select r.response_status,r.comment,r.created_at from public.equipment_condition_comparison_responses r where r.comparison_id=c.id order by r.event_sequence desc limit 1
      ) lr on true
     where coalesce(p_include_resolved,false) or c.comparison_status<>'RESOLVED'
  ) x;
  return v_result;
end $$;
revoke all on function public.list_equipment_condition_comparisons(boolean) from public,anon,authenticated;
grant execute on function public.list_equipment_condition_comparisons(boolean) to authenticated;

create or replace function public.get_my_equipment_condition_comparisons()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_partner_id uuid; v_result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  v_partner_id:=public.current_partner_id(); if v_partner_id is null then raise exception 'PARTNER_ACCESS_REQUIRED'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into v_result
  from (
    select c.id comparison_id,c.comparison_status,c.material_change,c.delta_snapshot,c.resolution_code,c.resolution_note,c.resolved_at,c.created_at,
           ec.contract_number,a.inventory_number,a.name equipment_name,a.brand,a.model,a.serial_number,
           c.acceptance_inspection_id,c.return_inspection_id,c.document_id,d.document_number,ar.inspected_on acceptance_date,rr.inspected_on return_date,
           lr.response_status partner_response_status,lr.comment partner_response_comment,lr.created_at partner_responded_at
      from public.equipment_condition_comparisons c
      join public.equipment_contracts ec on ec.id=c.contract_id
      join public.equipment_assets a on a.id=c.equipment_id
      left join public.equipment_condition_inspections ar on ar.id=c.acceptance_inspection_id
      join public.equipment_condition_inspections rr on rr.id=c.return_inspection_id
      left join public.documents d on d.id=c.document_id
      left join lateral (
        select r.response_status,r.comment,r.created_at from public.equipment_condition_comparison_responses r where r.comparison_id=c.id order by r.event_sequence desc limit 1
      ) lr on true
     where c.partner_id=v_partner_id
  ) x;
  return v_result;
end $$;
revoke all on function public.get_my_equipment_condition_comparisons() from public,anon,authenticated;
grant execute on function public.get_my_equipment_condition_comparisons() to authenticated;

create or replace function public.submit_equipment_condition_comparison_response(p_comparison_id uuid,p_response_status text,p_comment text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_partner_id uuid; v_partner_user_id uuid; v_case public.equipment_condition_comparisons%rowtype; v_status text:=upper(btrim(coalesce(p_response_status,''))); v_latest text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  v_partner_id:=public.current_partner_id(); v_partner_user_id:=public.current_partner_user_id();
  if v_partner_id is null or v_partner_user_id is null then raise exception 'PARTNER_ACCESS_REQUIRED'; end if;
  if v_status not in ('ACKNOWLEDGED','DISPUTED') then raise exception 'INVALID_RESPONSE_STATUS'; end if;
  if v_status='DISPUTED' and nullif(btrim(coalesce(p_comment,'')),'') is null then raise exception 'DISPUTE_COMMENT_REQUIRED'; end if;
  select * into v_case from public.equipment_condition_comparisons where id=p_comparison_id and partner_id=v_partner_id for share;
  if v_case.id is null then raise exception 'COMPARISON_NOT_AVAILABLE'; end if;
  if v_case.comparison_status<>'OPEN' then raise exception 'COMPARISON_NOT_OPEN_FOR_RESPONSE'; end if;
  select response_status into v_latest from public.equipment_condition_comparison_responses where comparison_id=v_case.id order by event_sequence desc limit 1;
  if v_latest=v_status then raise exception 'RESPONSE_ALREADY_CURRENT'; end if;
  insert into public.equipment_condition_comparison_responses(comparison_id,partner_id,partner_user_id,response_status,comment)
  values(v_case.id,v_partner_id,v_partner_user_id,v_status,nullif(btrim(coalesce(p_comment,'')),'')) returning id into v_id;
  if v_status='DISPUTED' then
    insert into public.notifications(user_id,title,body,type,entity_type,entity_id)
    select distinct u.id,'Владелец оспорил сверку состояния','Получено возражение владельца по возврату оборудования','WARNING','EQUIPMENT_CONDITION_COMPARISON',v_case.id
    from public.users u join public.user_roles ur on ur.user_id=u.id join public.roles ro on ro.id=ur.role_id
    left join public.role_permissions rp on rp.role_id=ro.id left join public.permissions pp on pp.id=rp.permission_id
    where u.is_active=true and (ro.name='ADMIN' or pp.code in ('equipment.manage','equipment.contracts.manage'));
  end if;
  return v_id;
end $$;
revoke all on function public.submit_equipment_condition_comparison_response(uuid,text,text) from public,anon,authenticated;
grant execute on function public.submit_equipment_condition_comparison_response(uuid,text,text) to authenticated;

create or replace function public.resolve_equipment_condition_comparison(p_comparison_id uuid,p_resolution_code text,p_resolution_note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_code text:=upper(btrim(coalesce(p_resolution_code,''))); v_actor uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not (public.has_permission('equipment.manage') or public.has_permission('equipment.contracts.manage')) then raise exception 'PERMISSION_DENIED'; end if;
  if v_code not in ('NORMAL_WEAR','HUB_RESPONSIBILITY','OWNER_RESPONSIBILITY','SHARED','NO_CLAIM','OTHER') then raise exception 'INVALID_RESOLUTION_CODE'; end if;
  if nullif(btrim(coalesce(p_resolution_note,'')),'') is null then raise exception 'RESOLUTION_NOTE_REQUIRED'; end if;
  v_actor:=public.current_staff_user_id(); if v_actor is null then raise exception 'STAFF_USER_NOT_FOUND'; end if;
  update public.equipment_condition_comparisons
     set comparison_status='RESOLVED',resolution_code=v_code,resolution_note=btrim(p_resolution_note),resolved_by=v_actor,resolved_at=clock_timestamp()
   where id=p_comparison_id and comparison_status='OPEN';
  if not found then raise exception 'COMPARISON_NOT_RESOLVABLE'; end if;
  return p_comparison_id;
end $$;
revoke all on function public.resolve_equipment_condition_comparison(uuid,text,text) from public,anon,authenticated;
grant execute on function public.resolve_equipment_condition_comparison(uuid,text,text) to authenticated;
