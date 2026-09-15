-- Phase 21 read models for HUB and equipment owners.

create or replace function public.list_equipment_contract_amendments(p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not (public.has_permission('equipment.view') or public.has_permission('equipment.contracts.manage')) then raise exception 'PERMISSION_DENIED'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into v_result
  from (
    select a.id amendment_id,a.contract_id,c.contract_number,c.contract_type,a.partner_id,coalesce(p.legal_name,p.name) partner_name,
           a.amendment_number,a.amendment_kind,a.status,a.effective_on,a.proposed_changes,a.before_snapshot,a.after_snapshot,a.reason,
           a.document_id,d.document_number,d.status document_status,a.created_at,a.approved_at,a.applied_at,a.cancelled_at
      from public.equipment_contract_amendments a
      join public.equipment_contracts c on c.id=a.contract_id
      join public.partners p on p.id=a.partner_id
      left join public.documents d on d.id=a.document_id
     where p_status is null or upper(btrim(p_status))='' or a.status=upper(btrim(p_status))
  ) x;
  return v_result;
end
$$;
revoke all on function public.list_equipment_contract_amendments(text) from public,anon,authenticated;
grant execute on function public.list_equipment_contract_amendments(text) to authenticated;

create or replace function public.get_my_equipment_contract_amendments()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_partner uuid; v_result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  v_partner:=public.current_partner_id();
  if v_partner is null then raise exception 'PARTNER_ACCESS_REQUIRED'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into v_result
  from (
    select a.id amendment_id,a.contract_id,c.contract_number,a.amendment_number,a.amendment_kind,a.status,a.effective_on,a.proposed_changes,a.reason,
           a.document_id,d.document_number,d.status document_status,a.created_at,a.approved_at,a.applied_at,a.cancelled_at
      from public.equipment_contract_amendments a
      join public.equipment_contracts c on c.id=a.contract_id
      left join public.documents d on d.id=a.document_id
     where a.partner_id=v_partner and (a.status in ('APPROVED','APPLIED') or (a.status='CANCELLED' and a.approved_at is not null))
  ) x;
  return v_result;
end
$$;
revoke all on function public.get_my_equipment_contract_amendments() from public,anon,authenticated;
grant execute on function public.get_my_equipment_contract_amendments() to authenticated;

create or replace function public.get_equipment_contract_amendment_document(p_amendment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_a public.equipment_contract_amendments%rowtype; v_partner uuid; v_staff boolean; v_result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  v_partner:=public.current_partner_id();
  v_staff:=public.has_permission('equipment.view') or public.has_permission('equipment.contracts.manage');
  select * into v_a from public.equipment_contract_amendments where id=p_amendment_id;
  if v_a.id is null then raise exception 'AMENDMENT_NOT_FOUND'; end if;
  if not v_staff and (v_partner is null or v_a.partner_id<>v_partner or not (v_a.status in ('APPROVED','APPLIED') or (v_a.status='CANCELLED' and v_a.approved_at is not null))) then raise exception 'AMENDMENT_NOT_AVAILABLE'; end if;
  select jsonb_build_object('amendment_id',v_a.id,'amendment_number',v_a.amendment_number,'status',v_a.status,'effective_on',v_a.effective_on,'reason',v_a.reason,
    'document_id',d.id,'document_number',d.document_number,'document_status',d.status,'title',d.title,'issue_date',d.issue_date,'metadata',d.metadata)
    into v_result from public.documents d where d.id=v_a.document_id;
  if v_result is null then raise exception 'DOCUMENT_NOT_FOUND'; end if;
  return v_result;
end
$$;
revoke all on function public.get_equipment_contract_amendment_document(uuid) from public,anon,authenticated;
grant execute on function public.get_equipment_contract_amendment_document(uuid) to authenticated;
