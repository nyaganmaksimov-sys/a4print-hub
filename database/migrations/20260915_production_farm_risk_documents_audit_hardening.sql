-- Phase 20 hardening: align with canonical audit_log old_data/new_data schema.

create or replace function public.audit_equipment_risk_record()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=public.current_staff_user_id();
  v_type text:=case tg_table_name when 'equipment_insurance_policies' then 'EQUIPMENT_INSURANCE_POLICY' else 'EQUIPMENT_IMPROVEMENT' end;
  v_id uuid;
begin
  v_id:=case when tg_op='DELETE' then old.id else new.id end;
  insert into public.audit_log(actor_user_id,actor_auth_user_id,action,entity_type,entity_id,old_data,new_data,reason,metadata,created_at)
  values(
    v_actor,auth.uid(),tg_op,v_type,v_id,
    case when tg_op='INSERT' then null else to_jsonb(old) end,
    case when tg_op='DELETE' then null else to_jsonb(new) end,
    null,'{}'::jsonb,clock_timestamp()
  );
  return case when tg_op='DELETE' then old else new end;
end
$$;

create or replace function public.register_equipment_risk_document(
  p_entity_type text,
  p_entity_id uuid,
  p_file_name text,
  p_mime_type text,
  p_file_size bigint,
  p_storage_path text,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_type text:=upper(btrim(coalesce(p_entity_type,'')));
  v_equipment_id uuid;
  v_title text;
  v_number text;
  v_document_type_id uuid;
  v_document_id uuid;
  v_actor uuid:=public.current_staff_user_id();
  v_type_code text;
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

  if v_type='INSURANCE' then
    update public.equipment_insurance_policies set document_id=v_document_id where id=p_entity_id;
  else
    update public.equipment_improvements set document_id=v_document_id where id=p_entity_id;
  end if;

  insert into public.audit_log(actor_user_id,actor_auth_user_id,action,entity_type,entity_id,old_data,new_data,reason,metadata,created_at)
  values(
    v_actor,auth.uid(),'DOCUMENT_ATTACHED',
    case when v_type='INSURANCE' then 'EQUIPMENT_INSURANCE_POLICY' else 'EQUIPMENT_IMPROVEMENT' end,
    p_entity_id,null,
    jsonb_build_object('document_id',v_document_id,'storage_bucket','hub-documents','storage_path',p_storage_path,'file_name',p_file_name),
    'Документ прикреплён к карточке','{}'::jsonb,clock_timestamp()
  );
  return v_document_id;
end
$$;

revoke all on function public.register_equipment_risk_document(text,uuid,text,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.register_equipment_risk_document(text,uuid,text,text,bigint,text,text) to authenticated;
