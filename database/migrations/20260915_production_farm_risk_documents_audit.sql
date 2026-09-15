-- Production Farm Phase 20: canonical documents + audit for insurance and improvements.

insert into public.document_types(name,code,description,requires_signature,default_validity_days)
select 'Страховой полис оборудования','EQUIPMENT_INSURANCE','Полис страхования производственного оборудования',false,null
where not exists(select 1 from public.document_types where code='EQUIPMENT_INSURANCE');

insert into public.document_types(name,code,description,requires_signature,default_validity_days)
select 'Документ модернизации оборудования','EQUIPMENT_IMPROVEMENT','Акт, счёт, фото или иной документ по улучшению оборудования',false,null
where not exists(select 1 from public.document_types where code='EQUIPMENT_IMPROVEMENT');

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('hub-documents','hub-documents',false,52428800,
array['application/pdf','image/jpeg','image/png','image/webp','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']::text[])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists hub_documents_staff_read on storage.objects;
create policy hub_documents_staff_read on storage.objects for select to authenticated
using(bucket_id='hub-documents' and public.is_hub_staff());
drop policy if exists hub_documents_equipment_manager_insert on storage.objects;
create policy hub_documents_equipment_manager_insert on storage.objects for insert to authenticated
with check(bucket_id='hub-documents' and public.has_permission('equipment.manage'));
drop policy if exists hub_documents_equipment_manager_update on storage.objects;
create policy hub_documents_equipment_manager_update on storage.objects for update to authenticated
using(bucket_id='hub-documents' and public.has_permission('equipment.manage'))
with check(bucket_id='hub-documents' and public.has_permission('equipment.manage'));
drop policy if exists hub_documents_equipment_manager_delete on storage.objects;
create policy hub_documents_equipment_manager_delete on storage.objects for delete to authenticated
using(bucket_id='hub-documents' and public.has_permission('equipment.manage'));

create or replace function public.audit_equipment_risk_record()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  v_actor uuid:=public.current_staff_user_id();
  v_type text:=case tg_table_name when 'equipment_insurance_policies' then 'EQUIPMENT_INSURANCE_POLICY' else 'EQUIPMENT_IMPROVEMENT' end;
  v_id uuid;
begin
  v_id:=case when tg_op='DELETE' then old.id else new.id end;
  insert into public.audit_log(actor_user_id,action,entity_type,entity_id,before_data,after_data,reason,created_at)
  values(v_actor,tg_op,v_type,v_id,
    case when tg_op='INSERT' then null else to_jsonb(old) end,
    case when tg_op='DELETE' then null else to_jsonb(new) end,
    null,clock_timestamp());
  return case when tg_op='DELETE' then old else new end;
end
$$;

drop trigger if exists trg_audit_equipment_insurance_policy on public.equipment_insurance_policies;
create trigger trg_audit_equipment_insurance_policy after insert or update or delete on public.equipment_insurance_policies
for each row execute function public.audit_equipment_risk_record();
drop trigger if exists trg_audit_equipment_improvement on public.equipment_improvements;
create trigger trg_audit_equipment_improvement after insert or update or delete on public.equipment_improvements
for each row execute function public.audit_equipment_risk_record();

create or replace function public.register_equipment_risk_document(
  p_entity_type text,p_entity_id uuid,p_file_name text,p_mime_type text,p_file_size bigint,p_storage_path text,p_notes text default null
) returns uuid
language plpgsql security definer set search_path=''
as $$
declare
  v_type text:=upper(btrim(coalesce(p_entity_type,'')));
  v_equipment_id uuid; v_title text; v_number text; v_document_type_id uuid; v_document_id uuid;
  v_actor uuid:=public.current_staff_user_id(); v_type_code text;
begin
  if not public.has_permission('equipment.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if p_entity_id is null then raise exception 'ENTITY_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_file_name,'')),'') is null then raise exception 'FILE_NAME_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_storage_path,'')),'') is null then raise exception 'STORAGE_PATH_REQUIRED'; end if;
  if p_file_size is null or p_file_size<=0 or p_file_size>52428800 then raise exception 'INVALID_FILE_SIZE'; end if;
  if p_storage_path not like 'equipment-risk/%' then raise exception 'INVALID_STORAGE_PATH'; end if;

  if v_type='INSURANCE' then
    select p.equipment_id,'Страховой полис '||p.policy_number,p.policy_number into v_equipment_id,v_title,v_number
    from public.equipment_insurance_policies p where p.id=p_entity_id;
    v_type_code:='EQUIPMENT_INSURANCE';
  elsif v_type='IMPROVEMENT' then
    select i.equipment_id,i.title,'UPG-'||to_char(i.completed_on,'YYYYMMDD')||'-'||substr(i.id::text,1,8) into v_equipment_id,v_title,v_number
    from public.equipment_improvements i where i.id=p_entity_id;
    v_type_code:='EQUIPMENT_IMPROVEMENT';
  else raise exception 'INVALID_ENTITY_TYPE'; end if;
  if v_equipment_id is null then raise exception 'ENTITY_NOT_FOUND'; end if;
  select id into v_document_type_id from public.document_types where code=v_type_code limit 1;
  if v_document_type_id is null then raise exception 'DOCUMENT_TYPE_NOT_FOUND'; end if;

  insert into public.documents(document_type_id,status,document_number,issue_date,title,notes,metadata,created_by,created_at,updated_at)
  values(v_document_type_id,'ACTIVE'::public.document_status,v_number,current_date,v_title,nullif(btrim(coalesce(p_notes,'')),''),
    jsonb_build_object('source','PRODUCTION_FARM','risk_entity_type',v_type,'risk_entity_id',p_entity_id,'equipment_id',v_equipment_id),
    v_actor,clock_timestamp(),clock_timestamp()) returning id into v_document_id;

  insert into public.document_versions(document_id,version_number,file_name,file_url,mime_type,file_size,created_by,comment,created_at)
  values(v_document_id,1,btrim(p_file_name),'storage://hub-documents/'||btrim(p_storage_path),nullif(btrim(coalesce(p_mime_type,'')),''),p_file_size,v_actor,
    'Файл производственного оборудования',clock_timestamp());

  insert into public.document_links(document_id,entity_type,entity_id,relationship,created_at)
  values(v_document_id,case when v_type='INSURANCE' then 'EQUIPMENT_INSURANCE_POLICY' else 'EQUIPMENT_IMPROVEMENT' end,p_entity_id,'ATTACHMENT',clock_timestamp());

  if v_type='INSURANCE' then update public.equipment_insurance_policies set document_id=v_document_id where id=p_entity_id;
  else update public.equipment_improvements set document_id=v_document_id where id=p_entity_id; end if;

  insert into public.audit_log(actor_user_id,action,entity_type,entity_id,after_data,reason,created_at)
  values(v_actor,'DOCUMENT_ATTACHED',case when v_type='INSURANCE' then 'EQUIPMENT_INSURANCE_POLICY' else 'EQUIPMENT_IMPROVEMENT' end,p_entity_id,
    jsonb_build_object('document_id',v_document_id,'storage_bucket','hub-documents','storage_path',p_storage_path,'file_name',p_file_name),
    'Документ прикреплён к карточке',clock_timestamp());
  return v_document_id;
end
$$;
revoke all on function public.register_equipment_risk_document(text,uuid,text,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.register_equipment_risk_document(text,uuid,text,text,bigint,text,text) to authenticated;

create or replace function public.get_equipment_risk_documents()
returns table(document_id uuid,entity_type text,entity_id uuid,equipment_id uuid,document_type_code text,title text,document_number text,document_status text,document_date date,notes text,file_name text,mime_type text,file_size bigint,storage_path text,created_at timestamptz)
language sql security definer set search_path='' stable
as $$
  select d.id,l.entity_type,l.entity_id,
    nullif(d.metadata->>'equipment_id','')::uuid,
    dt.code,d.title,d.document_number,d.status::text,d.issue_date,d.notes,
    v.file_name,v.mime_type,v.file_size,
    case when v.file_url like 'storage://hub-documents/%' then substr(v.file_url,length('storage://hub-documents/')+1) else null end,
    d.created_at
  from public.document_links l
  join public.documents d on d.id=l.document_id
  join public.document_types dt on dt.id=d.document_type_id
  left join lateral (
    select dv.file_name,dv.mime_type,dv.file_size,dv.file_url
    from public.document_versions dv
    where dv.document_id=d.id
    order by dv.version_number desc,dv.created_at desc limit 1
  ) v on true
  where public.has_permission('equipment.view')
    and l.entity_type in ('EQUIPMENT_INSURANCE_POLICY','EQUIPMENT_IMPROVEMENT')
  order by d.created_at desc
$$;
revoke all on function public.get_equipment_risk_documents() from public,anon;
grant execute on function public.get_equipment_risk_documents() to authenticated,service_role;
