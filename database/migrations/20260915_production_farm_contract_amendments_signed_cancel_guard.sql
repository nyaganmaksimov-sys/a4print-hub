create or replace function public.cancel_equipment_contract_amendment(p_amendment_id uuid,p_reason text)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare v_a public.equipment_contract_amendments%rowtype; v_actor uuid; v_old public.document_status;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_permission('equipment.contracts.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'CANCEL_REASON_REQUIRED'; end if;
  select * into v_a from public.equipment_contract_amendments where id=p_amendment_id for update;
  if v_a.id is null then raise exception 'AMENDMENT_NOT_FOUND'; end if;
  if v_a.status not in ('DRAFT','APPROVED') then raise exception 'AMENDMENT_CANNOT_BE_CANCELLED'; end if;
  select status into v_old from public.documents where id=v_a.document_id for update;
  if v_old in ('SIGNED'::public.document_status,'ACTIVE'::public.document_status) then raise exception 'SIGNED_AMENDMENT_CANNOT_BE_CANCELLED'; end if;
  v_actor:=public.current_staff_user_id();
  update public.equipment_contract_amendments set status='CANCELLED',cancelled_by=v_actor,cancelled_at=clock_timestamp(),reason=reason||E'\nОтмена: '||btrim(p_reason) where id=v_a.id;
  if v_old<>'ARCHIVED'::public.document_status then
    update public.documents set status='ARCHIVED'::public.document_status,archived_at=coalesce(archived_at,clock_timestamp()),updated_at=clock_timestamp() where id=v_a.document_id;
    insert into public.document_status_history(document_id,old_status,new_status,changed_by,comment)
    values(v_a.document_id,v_old,'ARCHIVED'::public.document_status,v_actor,btrim(p_reason));
  end if;
  return v_a.id;
end
$$;
revoke all on function public.cancel_equipment_contract_amendment(uuid,text) from public,anon,authenticated;
grant execute on function public.cancel_equipment_contract_amendment(uuid,text) to authenticated;
