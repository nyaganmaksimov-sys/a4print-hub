-- A4PRINT HUB: Production Farm Phase 23 — physical condition inspections on intake/return.

insert into public.document_types(name,code,description,requires_signature,default_validity_days)
select 'Акт осмотра состояния оборудования','EQ_CONDITION_INSPECTION','Приёмочный, возвратный или периодический осмотр оборудования с фото, комплектностью и дефектами',false,null
where not exists(select 1 from public.document_types where code='EQ_CONDITION_INSPECTION');

create table if not exists public.equipment_condition_inspections (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment_assets(id) on delete restrict,
  contract_id uuid not null references public.equipment_contracts(id) on delete restrict,
  partner_id uuid not null references public.partners(id) on delete restrict,
  termination_id uuid references public.equipment_contract_terminations(id) on delete restrict,
  inspection_type text not null check(inspection_type in ('ACCEPTANCE','RETURN','PERIODIC')),
  status text not null default 'DRAFT' check(status in ('DRAFT','COMPLETED','CANCELLED')),
  inspected_on date not null default current_date,
  location text,
  meter_hours numeric check(meter_hours is null or meter_hours>=0),
  condition_grade text not null default 'GOOD' check(condition_grade in ('EXCELLENT','GOOD','FAIR','POOR','NON_OPERATIONAL')),
  operational_state text not null default 'READY' check(operational_state in ('READY','LIMITED','NOT_OPERATIONAL')),
  checklist jsonb not null default '[]'::jsonb,
  defects jsonb not null default '[]'::jsonb,
  notes text,
  document_id uuid unique references public.documents(id) on delete restrict,
  completion_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.users(id) on delete restrict,
  completed_by uuid references public.users(id) on delete restrict,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create unique index if not exists equipment_condition_inspections_open_uidx
  on public.equipment_condition_inspections(contract_id,equipment_id,inspection_type)
  where status='DRAFT';
create index if not exists equipment_condition_inspections_equipment_idx on public.equipment_condition_inspections(equipment_id,inspected_on desc);
create index if not exists equipment_condition_inspections_contract_idx on public.equipment_condition_inspections(contract_id,inspected_on desc);
create index if not exists equipment_condition_inspections_partner_idx on public.equipment_condition_inspections(partner_id,inspected_on desc);
create index if not exists equipment_condition_inspections_termination_idx on public.equipment_condition_inspections(termination_id) where termination_id is not null;
create index if not exists equipment_condition_inspections_created_by_idx on public.equipment_condition_inspections(created_by);
create index if not exists equipment_condition_inspections_completed_by_idx on public.equipment_condition_inspections(completed_by) where completed_by is not null;

create table if not exists public.equipment_condition_inspection_files (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.equipment_condition_inspections(id) on delete restrict,
  file_kind text not null default 'PHOTO' check(file_kind in ('PHOTO','DOCUMENT','OTHER')),
  file_name text not null,
  mime_type text,
  file_size bigint not null check(file_size>0 and file_size<=52428800),
  storage_path text not null unique,
  caption text,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists equipment_condition_inspection_files_inspection_idx on public.equipment_condition_inspection_files(inspection_id,created_at);
create index if not exists equipment_condition_inspection_files_created_by_idx on public.equipment_condition_inspection_files(created_by);

alter table public.equipment_condition_inspections enable row level security;
alter table public.equipment_condition_inspection_files enable row level security;

drop policy if exists equipment_condition_inspections_read on public.equipment_condition_inspections;
create policy equipment_condition_inspections_read on public.equipment_condition_inspections for select to authenticated
using(public.has_permission('equipment.view') or public.has_permission('equipment.manage') or public.has_permission('equipment.contracts.manage') or (status='COMPLETED' and partner_id=public.current_partner_id()));

drop policy if exists equipment_condition_inspection_files_read on public.equipment_condition_inspection_files;
create policy equipment_condition_inspection_files_read on public.equipment_condition_inspection_files for select to authenticated
using(exists(select 1 from public.equipment_condition_inspections i where i.id=inspection_id and (public.has_permission('equipment.view') or public.has_permission('equipment.manage') or public.has_permission('equipment.contracts.manage') or (i.status='COMPLETED' and i.partner_id=public.current_partner_id()))));

revoke all on public.equipment_condition_inspections from public,anon,authenticated;
revoke all on public.equipment_condition_inspection_files from public,anon,authenticated;
grant select on public.equipment_condition_inspections to authenticated;
grant select on public.equipment_condition_inspection_files to authenticated;

drop trigger if exists trg_equipment_condition_inspections_updated_at on public.equipment_condition_inspections;
create trigger trg_equipment_condition_inspections_updated_at before update on public.equipment_condition_inspections for each row execute function public.touch_production_farm_updated_at();
drop trigger if exists trg_audit_equipment_condition_inspections on public.equipment_condition_inspections;
create trigger trg_audit_equipment_condition_inspections after insert or update or delete on public.equipment_condition_inspections for each row execute function public.audit_row_change();
drop trigger if exists trg_audit_equipment_condition_inspection_files on public.equipment_condition_inspection_files;
create trigger trg_audit_equipment_condition_inspection_files after insert or update or delete on public.equipment_condition_inspection_files for each row execute function public.audit_row_change();

create or replace function public.validate_equipment_condition_checklist(p_checklist jsonb) returns void language plpgsql set search_path='' as $$
declare r jsonb; v_result text;
begin
  if p_checklist is null or jsonb_typeof(p_checklist)<>'array' or jsonb_array_length(p_checklist)=0 then raise exception 'CHECKLIST_REQUIRED'; end if;
  for r in select value from jsonb_array_elements(p_checklist) loop
    if jsonb_typeof(r)<>'object' then raise exception 'INVALID_CHECKLIST_ITEM'; end if;
    if nullif(btrim(coalesce(r->>'label','')),'') is null then raise exception 'CHECKLIST_LABEL_REQUIRED'; end if;
    v_result:=upper(btrim(coalesce(r->>'result','')));
    if v_result not in ('PASS','ISSUE','NA') then raise exception 'INVALID_CHECKLIST_RESULT'; end if;
  end loop;
end $$;
revoke all on function public.validate_equipment_condition_checklist(jsonb) from public,anon,authenticated;

create or replace function public.guard_completed_equipment_condition_inspection() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' and old.status='COMPLETED' then raise exception 'COMPLETED_INSPECTION_IMMUTABLE'; end if;
  if tg_op='UPDATE' and old.status='COMPLETED' then raise exception 'COMPLETED_INSPECTION_IMMUTABLE'; end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.guard_completed_equipment_condition_inspection() from public,anon,authenticated;
drop trigger if exists trg_guard_completed_equipment_condition_inspection on public.equipment_condition_inspections;
create trigger trg_guard_completed_equipment_condition_inspection before update or delete on public.equipment_condition_inspections for each row execute function public.guard_completed_equipment_condition_inspection();

create or replace function public.guard_equipment_condition_inspection_file_change() returns trigger language plpgsql set search_path='' as $$
declare v_inspection_id uuid; v_status text;
begin
  v_inspection_id:=case when tg_op='DELETE' then old.inspection_id else new.inspection_id end;
  select status into v_status from public.equipment_condition_inspections where id=v_inspection_id;
  if v_status='COMPLETED' then raise exception 'COMPLETED_INSPECTION_FILES_IMMUTABLE'; end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.guard_equipment_condition_inspection_file_change() from public,anon,authenticated;
drop trigger if exists trg_guard_equipment_condition_inspection_file_change on public.equipment_condition_inspection_files;
create trigger trg_guard_equipment_condition_inspection_file_change before insert or update or delete on public.equipment_condition_inspection_files for each row execute function public.guard_equipment_condition_inspection_file_change();

create or replace function public.save_equipment_condition_inspection(
  p_inspection_id uuid,p_contract_id uuid,p_equipment_id uuid,p_inspection_type text,p_termination_id uuid default null,p_inspected_on date default current_date,
  p_location text default null,p_meter_hours numeric default null,p_condition_grade text default 'GOOD',p_operational_state text default 'READY',
  p_checklist jsonb default '[]'::jsonb,p_defects jsonb default '[]'::jsonb,p_notes text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_type text:=upper(btrim(coalesce(p_inspection_type,''))); v_grade text:=upper(btrim(coalesce(p_condition_grade,''))); v_state text:=upper(btrim(coalesce(p_operational_state,''))); v_partner_id uuid; v_actor uuid; v_id uuid; v_existing_status text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_permission('equipment.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if p_contract_id is null or p_equipment_id is null then raise exception 'CONTRACT_AND_EQUIPMENT_REQUIRED'; end if;
  if v_type not in ('ACCEPTANCE','RETURN','PERIODIC') then raise exception 'INVALID_INSPECTION_TYPE'; end if;
  if v_grade not in ('EXCELLENT','GOOD','FAIR','POOR','NON_OPERATIONAL') then raise exception 'INVALID_CONDITION_GRADE'; end if;
  if v_state not in ('READY','LIMITED','NOT_OPERATIONAL') then raise exception 'INVALID_OPERATIONAL_STATE'; end if;
  if p_meter_hours is not null and p_meter_hours<0 then raise exception 'INVALID_METER_HOURS'; end if;
  perform public.validate_equipment_condition_checklist(p_checklist);
  if p_defects is null or jsonb_typeof(p_defects)<>'array' then raise exception 'INVALID_DEFECTS'; end if;
  select c.partner_id into v_partner_id from public.equipment_contracts c where c.id=p_contract_id;
  if v_partner_id is null then raise exception 'CONTRACT_NOT_FOUND'; end if;
  if not exists(select 1 from public.equipment_contract_assets ca where ca.contract_id=p_contract_id and ca.equipment_id=p_equipment_id) then raise exception 'EQUIPMENT_NOT_IN_CONTRACT'; end if;
  if v_type='RETURN' then
    if p_termination_id is null then raise exception 'TERMINATION_REQUIRED_FOR_RETURN'; end if;
    if not exists(select 1 from public.equipment_contract_terminations t where t.id=p_termination_id and t.contract_id=p_contract_id and t.partner_id=v_partner_id and t.status in ('NOTICE','PREPARING','READY')) then raise exception 'TERMINATION_NOT_AVAILABLE_FOR_RETURN'; end if;
  elsif p_termination_id is not null then raise exception 'TERMINATION_ONLY_FOR_RETURN'; end if;
  v_actor:=public.current_staff_user_id(); if v_actor is null then raise exception 'STAFF_USER_NOT_FOUND'; end if;
  if p_inspection_id is null then
    insert into public.equipment_condition_inspections(equipment_id,contract_id,partner_id,termination_id,inspection_type,status,inspected_on,location,meter_hours,condition_grade,operational_state,checklist,defects,notes,created_by)
    values(p_equipment_id,p_contract_id,v_partner_id,p_termination_id,v_type,'DRAFT',coalesce(p_inspected_on,current_date),nullif(btrim(coalesce(p_location,'')),''),p_meter_hours,v_grade,v_state,p_checklist,p_defects,nullif(btrim(coalesce(p_notes,'')),''),v_actor) returning id into v_id;
  else
    select status into v_existing_status from public.equipment_condition_inspections where id=p_inspection_id for update;
    if v_existing_status is null then raise exception 'INSPECTION_NOT_FOUND'; end if;
    if v_existing_status<>'DRAFT' then raise exception 'INSPECTION_NOT_EDITABLE'; end if;
    update public.equipment_condition_inspections set equipment_id=p_equipment_id,contract_id=p_contract_id,partner_id=v_partner_id,termination_id=p_termination_id,inspection_type=v_type,inspected_on=coalesce(p_inspected_on,current_date),location=nullif(btrim(coalesce(p_location,'')),''),meter_hours=p_meter_hours,condition_grade=v_grade,operational_state=v_state,checklist=p_checklist,defects=p_defects,notes=nullif(btrim(coalesce(p_notes,'')),'') where id=p_inspection_id;
    v_id:=p_inspection_id;
  end if;
  return v_id;
end $$;
revoke all on function public.save_equipment_condition_inspection(uuid,uuid,uuid,text,uuid,date,text,numeric,text,text,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.save_equipment_condition_inspection(uuid,uuid,uuid,text,uuid,date,text,numeric,text,text,jsonb,jsonb,text) to authenticated;

create or replace function public.register_equipment_condition_inspection_file(p_inspection_id uuid,p_file_kind text,p_file_name text,p_mime_type text,p_file_size bigint,p_storage_path text,p_caption text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_kind text:=upper(btrim(coalesce(p_file_kind,'PHOTO'))); v_actor uuid; v_id uuid; v_status text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_permission('equipment.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if p_inspection_id is null then raise exception 'INSPECTION_REQUIRED'; end if;
  select status into v_status from public.equipment_condition_inspections where id=p_inspection_id for update;
  if v_status is null then raise exception 'INSPECTION_NOT_FOUND'; end if;
  if v_status<>'DRAFT' then raise exception 'INSPECTION_NOT_EDITABLE'; end if;
  if v_kind not in ('PHOTO','DOCUMENT','OTHER') then raise exception 'INVALID_FILE_KIND'; end if;
  if nullif(btrim(coalesce(p_file_name,'')),'') is null then raise exception 'FILE_NAME_REQUIRED'; end if;
  if p_file_size is null or p_file_size<=0 or p_file_size>52428800 then raise exception 'INVALID_FILE_SIZE'; end if;
  if nullif(btrim(coalesce(p_storage_path,'')),'') is null or p_storage_path not like ('equipment-inspections/'||p_inspection_id::text||'/%') then raise exception 'INVALID_STORAGE_PATH'; end if;
  v_actor:=public.current_staff_user_id();
  insert into public.equipment_condition_inspection_files(inspection_id,file_kind,file_name,mime_type,file_size,storage_path,caption,created_by)
  values(p_inspection_id,v_kind,btrim(p_file_name),nullif(btrim(coalesce(p_mime_type,'')),''),p_file_size,btrim(p_storage_path),nullif(btrim(coalesce(p_caption,'')),''),v_actor) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.register_equipment_condition_inspection_file(uuid,text,text,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.register_equipment_condition_inspection_file(uuid,text,text,text,bigint,text,text) to authenticated;

create or replace function public.remove_equipment_condition_inspection_file(p_file_id uuid) returns text language plpgsql security definer set search_path='' as $$
declare v_path text; v_status text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_permission('equipment.manage') then raise exception 'PERMISSION_DENIED'; end if;
  select f.storage_path,i.status into v_path,v_status from public.equipment_condition_inspection_files f join public.equipment_condition_inspections i on i.id=f.inspection_id where f.id=p_file_id for update of f;
  if v_path is null then raise exception 'FILE_NOT_FOUND'; end if;
  if v_status<>'DRAFT' then raise exception 'INSPECTION_NOT_EDITABLE'; end if;
  delete from public.equipment_condition_inspection_files where id=p_file_id;
  return v_path;
end $$;
revoke all on function public.remove_equipment_condition_inspection_file(uuid) from public,anon,authenticated;
grant execute on function public.remove_equipment_condition_inspection_file(uuid) to authenticated;

create or replace function public.complete_equipment_condition_inspection(p_inspection_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_i public.equipment_condition_inspections%rowtype; v_actor uuid; v_doc_type uuid; v_doc uuid; v_number text; v_title text; v_type_label text;
  v_equipment jsonb; v_partner jsonb; v_contract jsonb; v_files jsonb; v_snapshot jsonb; v_issue_count integer; v_photo_count integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_permission('equipment.manage') then raise exception 'PERMISSION_DENIED'; end if;
  select * into v_i from public.equipment_condition_inspections where id=p_inspection_id for update;
  if v_i.id is null then raise exception 'INSPECTION_NOT_FOUND'; end if;
  if v_i.status<>'DRAFT' then raise exception 'INSPECTION_NOT_COMPLETABLE'; end if;
  perform public.validate_equipment_condition_checklist(v_i.checklist);
  select count(*) into v_issue_count from jsonb_array_elements(v_i.checklist) x where upper(coalesce(x->>'result',''))='ISSUE';
  if (v_issue_count>0 or v_i.condition_grade in ('POOR','NON_OPERATIONAL') or v_i.operational_state<>'READY') and jsonb_array_length(v_i.defects)=0 then raise exception 'DEFECT_DESCRIPTION_REQUIRED'; end if;
  select count(*) into v_photo_count from public.equipment_condition_inspection_files f where f.inspection_id=v_i.id and f.file_kind='PHOTO';
  if v_i.inspection_type in ('ACCEPTANCE','RETURN') and v_photo_count<1 then raise exception 'INSPECTION_PHOTO_REQUIRED'; end if;
  select jsonb_build_object('id',a.id,'inventory_number',a.inventory_number,'name',a.name,'category',a.category,'brand',a.brand,'model',a.model,'serial_number',a.serial_number,'location',a.location,'ownership_type',a.ownership_type,'operational_status',a.operational_status,'manufacture_year',a.manufacture_year,'market_value',a.market_value) into v_equipment from public.equipment_assets a where a.id=v_i.equipment_id;
  select jsonb_build_object('id',p.id,'name',p.name,'legal_name',p.legal_name,'tax_id',p.tax_id,'registration_number',p.registration_number,'address',p.address,'contact_name',p.contact_name,'email',p.email,'phone',p.phone) into v_partner from public.partners p where p.id=v_i.partner_id;
  v_contract:=public.equipment_contract_legal_snapshot(v_i.contract_id);
  select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'file_kind',f.file_kind,'file_name',f.file_name,'mime_type',f.mime_type,'file_size',f.file_size,'storage_path',f.storage_path,'caption',f.caption,'created_at',f.created_at) order by f.created_at),'[]'::jsonb) into v_files from public.equipment_condition_inspection_files f where f.inspection_id=v_i.id;
  v_actor:=public.current_staff_user_id();
  v_type_label:=case v_i.inspection_type when 'ACCEPTANCE' then 'Приёмка' when 'RETURN' then 'Возврат' else 'Периодический осмотр' end;
  v_number:='INSP-'||to_char(v_i.inspected_on,'YYYYMMDD')||'-'||upper(substr(v_i.id::text,1,8));
  v_title:='Акт осмотра оборудования · '||v_type_label||' · '||coalesce(v_equipment->>'inventory_number',v_equipment->>'name','оборудование');
  v_snapshot:=jsonb_build_object('schema_version',1,'inspection_id',v_i.id,'inspection_type',v_i.inspection_type,'status','COMPLETED','inspected_on',v_i.inspected_on,'location',v_i.location,'meter_hours',v_i.meter_hours,'condition_grade',v_i.condition_grade,'operational_state',v_i.operational_state,'checklist',v_i.checklist,'defects',v_i.defects,'notes',v_i.notes,'equipment',v_equipment,'partner',v_partner,'contract',v_contract,'termination_id',v_i.termination_id,'files',v_files,'completed_by',v_actor,'completed_at',clock_timestamp());
  select id into v_doc_type from public.document_types where code='EQ_CONDITION_INSPECTION'; if v_doc_type is null then raise exception 'DOCUMENT_TYPE_NOT_FOUND'; end if;
  insert into public.documents(document_type_id,document_number,title,status,business_unit,issue_date,created_by,notes,metadata,created_at,updated_at)
  values(v_doc_type,v_number,v_title,'ACTIVE'::public.document_status,'COMMON'::public.business_unit,v_i.inspected_on,v_actor,v_i.notes,v_snapshot,clock_timestamp(),clock_timestamp()) returning id into v_doc;
  insert into public.document_links(document_id,entity_type,entity_id,relationship,created_at) values(v_doc,'EQUIPMENT_CONDITION_INSPECTION',v_i.id,'SOURCE',clock_timestamp()) on conflict do nothing;
  insert into public.document_links(document_id,entity_type,entity_id,relationship,created_at) values(v_doc,'EQUIPMENT_ASSET',v_i.equipment_id,'INSPECTION',clock_timestamp()) on conflict do nothing;
  insert into public.document_links(document_id,entity_type,entity_id,relationship,created_at) values(v_doc,'EQUIPMENT_CONTRACT',v_i.contract_id,'INSPECTION',clock_timestamp()) on conflict do nothing;
  insert into public.document_links(document_id,entity_type,entity_id,relationship,created_at) values(v_doc,'PARTNER',v_i.partner_id,'INSPECTION',clock_timestamp()) on conflict do nothing;
  if v_i.termination_id is not null then insert into public.document_links(document_id,entity_type,entity_id,relationship,created_at) values(v_doc,'EQUIPMENT_CONTRACT_TERMINATION',v_i.termination_id,'RETURN_INSPECTION',clock_timestamp()) on conflict do nothing; end if;
  update public.equipment_condition_inspections set status='COMPLETED',document_id=v_doc,completion_snapshot=v_snapshot,completed_by=v_actor,completed_at=clock_timestamp() where id=v_i.id;
  return v_doc;
end $$;
revoke all on function public.complete_equipment_condition_inspection(uuid) from public,anon,authenticated;
grant execute on function public.complete_equipment_condition_inspection(uuid) to authenticated;

create or replace function public.cancel_equipment_condition_inspection(p_inspection_id uuid,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if; if not public.has_permission('equipment.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'CANCEL_REASON_REQUIRED'; end if;
  update public.equipment_condition_inspections set status='CANCELLED',notes=concat_ws(E'\n',notes,'Отменено: '||btrim(p_reason)) where id=p_inspection_id and status='DRAFT';
  if not found then raise exception 'INSPECTION_NOT_CANCELLABLE'; end if; return p_inspection_id;
end $$;
revoke all on function public.cancel_equipment_condition_inspection(uuid,text) from public,anon,authenticated;
grant execute on function public.cancel_equipment_condition_inspection(uuid,text) to authenticated;

create or replace function public.list_equipment_condition_inspections(p_include_cancelled boolean default false) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  if not (public.has_permission('equipment.view') or public.has_permission('equipment.manage') or public.has_permission('equipment.contracts.manage')) then raise exception 'PERMISSION_DENIED'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.inspected_on desc,x.created_at desc),'[]'::jsonb) into v_result from (
    select i.id inspection_id,i.inspection_type,i.status,i.inspected_on,i.location,i.meter_hours,i.condition_grade,i.operational_state,i.checklist,i.defects,i.notes,i.contract_id,c.contract_number,i.partner_id,coalesce(p.legal_name,p.name) partner_name,i.equipment_id,a.inventory_number,a.name equipment_name,a.brand,a.model,a.serial_number,i.termination_id,i.document_id,d.document_number,i.created_at,i.completed_at,
           coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'file_kind',f.file_kind,'file_name',f.file_name,'mime_type',f.mime_type,'file_size',f.file_size,'storage_path',f.storage_path,'caption',f.caption,'created_at',f.created_at) order by f.created_at) from public.equipment_condition_inspection_files f where f.inspection_id=i.id),'[]'::jsonb) files
      from public.equipment_condition_inspections i join public.equipment_contracts c on c.id=i.contract_id join public.partners p on p.id=i.partner_id join public.equipment_assets a on a.id=i.equipment_id left join public.documents d on d.id=i.document_id
     where coalesce(p_include_cancelled,false) or i.status<>'CANCELLED'
  ) x; return v_result;
end $$;
revoke all on function public.list_equipment_condition_inspections(boolean) from public,anon,authenticated;
grant execute on function public.list_equipment_condition_inspections(boolean) to authenticated;

create or replace function public.get_equipment_condition_inspection_targets() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  if not public.has_permission('equipment.manage') then raise exception 'PERMISSION_DENIED'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.partner_name,x.contract_number,x.inventory_number),'[]'::jsonb) into v_result from (
    select c.id contract_id,c.contract_number,c.status contract_status,c.starts_on,c.ends_on,c.partner_id,coalesce(p.legal_name,p.name) partner_name,a.id equipment_id,a.inventory_number,a.name equipment_name,a.brand,a.model,a.serial_number,a.location,a.operational_status,
           (select t.id from public.equipment_contract_terminations t where t.contract_id=c.id and t.status in ('NOTICE','PREPARING','READY') order by t.created_at desc limit 1) termination_id,
           (select t.status from public.equipment_contract_terminations t where t.contract_id=c.id and t.status in ('NOTICE','PREPARING','READY') order by t.created_at desc limit 1) termination_status,
           exists(select 1 from public.equipment_condition_inspections i where i.contract_id=c.id and i.equipment_id=a.id and i.inspection_type='ACCEPTANCE' and i.status='COMPLETED') has_acceptance_inspection
      from public.equipment_contracts c join public.partners p on p.id=c.partner_id join public.equipment_contract_assets ca on ca.contract_id=c.id join public.equipment_assets a on a.id=ca.equipment_id
     where c.status in ('ACTIVE','SUSPENDED')
  ) x; return v_result;
end $$;
revoke all on function public.get_equipment_condition_inspection_targets() from public,anon,authenticated;
grant execute on function public.get_equipment_condition_inspection_targets() to authenticated;

create or replace function public.get_my_equipment_condition_inspections() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_partner_id uuid; v_result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if; v_partner_id:=public.current_partner_id(); if v_partner_id is null then raise exception 'PARTNER_ACCESS_REQUIRED'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.inspected_on desc,x.completed_at desc),'[]'::jsonb) into v_result from (
    select i.id inspection_id,i.inspection_type,i.inspected_on,i.location,i.meter_hours,i.condition_grade,i.operational_state,i.checklist,i.defects,i.notes,c.contract_number,a.inventory_number,a.name equipment_name,a.brand,a.model,a.serial_number,i.document_id,d.document_number,i.completed_at,
           coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'file_kind',f.file_kind,'file_name',f.file_name,'mime_type',f.mime_type,'file_size',f.file_size,'storage_path',f.storage_path,'caption',f.caption) order by f.created_at) from public.equipment_condition_inspection_files f where f.inspection_id=i.id),'[]'::jsonb) files
      from public.equipment_condition_inspections i join public.equipment_contracts c on c.id=i.contract_id join public.equipment_assets a on a.id=i.equipment_id left join public.documents d on d.id=i.document_id
     where i.partner_id=v_partner_id and i.status='COMPLETED'
  ) x; return v_result;
end $$;
revoke all on function public.get_my_equipment_condition_inspections() from public,anon,authenticated;
grant execute on function public.get_my_equipment_condition_inspections() to authenticated;

create or replace function public.guard_equipment_termination_return_inspections() returns trigger language plpgsql set search_path='' as $$
begin
  if new.status='COMPLETED' and old.status is distinct from 'COMPLETED' then
    if exists(select 1 from public.equipment_contract_assets ca where ca.contract_id=new.contract_id and not exists(select 1 from public.equipment_condition_inspections i where i.contract_id=new.contract_id and i.equipment_id=ca.equipment_id and i.termination_id=new.id and i.inspection_type='RETURN' and i.status='COMPLETED')) then raise exception 'RETURN_INSPECTION_REQUIRED'; end if;
  end if; return new;
end $$;
revoke all on function public.guard_equipment_termination_return_inspections() from public,anon,authenticated;
drop trigger if exists trg_guard_equipment_termination_return_inspections on public.equipment_contract_terminations;
create trigger trg_guard_equipment_termination_return_inspections before update of status on public.equipment_contract_terminations for each row execute function public.guard_equipment_termination_return_inspections();

drop policy if exists hub_documents_equipment_partner_inspection_read on storage.objects;
create policy hub_documents_equipment_partner_inspection_read on storage.objects for select to authenticated
using(bucket_id='hub-documents' and exists(select 1 from public.equipment_condition_inspection_files f join public.equipment_condition_inspections i on i.id=f.inspection_id where f.storage_path=name and i.status='COMPLETED' and i.partner_id=public.current_partner_id()));
