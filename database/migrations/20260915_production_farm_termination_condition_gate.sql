-- A4PRINT HUB: Production Farm Phase 25 — termination gate for unresolved condition comparisons.

create or replace function public.get_equipment_contract_termination_condition_preflight(p_termination_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_t public.equipment_contract_terminations%rowtype;
  v_equipment_count integer:=0;
  v_completed_returns integer:=0;
  v_missing_returns integer:=0;
  v_missing_comparisons integer:=0;
  v_open_comparisons integer:=0;
  v_missing_return_items jsonb:='[]'::jsonb;
  v_missing_comparison_items jsonb:='[]'::jsonb;
  v_open_comparison_items jsonb:='[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_permission('equipment.contracts.manage') then raise exception 'PERMISSION_DENIED'; end if;

  select * into v_t
    from public.equipment_contract_terminations
   where id=p_termination_id;
  if v_t.id is null then raise exception 'TERMINATION_NOT_FOUND'; end if;

  select count(*)::integer into v_equipment_count
    from public.equipment_contract_assets ca
   where ca.contract_id=v_t.contract_id;

  select count(*)::integer into v_completed_returns
    from public.equipment_contract_assets ca
   where ca.contract_id=v_t.contract_id
     and exists(
       select 1 from public.equipment_condition_inspections i
        where i.contract_id=v_t.contract_id
          and i.equipment_id=ca.equipment_id
          and i.termination_id=v_t.id
          and i.inspection_type='RETURN'
          and i.status='COMPLETED'
     );

  select count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object(
           'equipment_id',a.id,
           'inventory_number',a.inventory_number,
           'equipment_name',a.name,
           'brand',a.brand,
           'model',a.model,
           'serial_number',a.serial_number
         ) order by a.inventory_number,a.name),'[]'::jsonb)
    into v_missing_returns,v_missing_return_items
    from public.equipment_contract_assets ca
    join public.equipment_assets a on a.id=ca.equipment_id
   where ca.contract_id=v_t.contract_id
     and not exists(
       select 1 from public.equipment_condition_inspections i
        where i.contract_id=v_t.contract_id
          and i.equipment_id=ca.equipment_id
          and i.termination_id=v_t.id
          and i.inspection_type='RETURN'
          and i.status='COMPLETED'
     );

  select count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object(
           'equipment_id',a.id,
           'inventory_number',a.inventory_number,
           'equipment_name',a.name,
           'brand',a.brand,
           'model',a.model,
           'serial_number',a.serial_number
         ) order by a.inventory_number,a.name),'[]'::jsonb)
    into v_missing_comparisons,v_missing_comparison_items
    from public.equipment_contract_assets ca
    join public.equipment_assets a on a.id=ca.equipment_id
   where ca.contract_id=v_t.contract_id
     and exists(
       select 1 from public.equipment_condition_inspections i
        where i.contract_id=v_t.contract_id
          and i.equipment_id=ca.equipment_id
          and i.termination_id=v_t.id
          and i.inspection_type='RETURN'
          and i.status='COMPLETED'
     )
     and not exists(
       select 1
         from public.equipment_condition_inspections i
         join public.equipment_condition_comparisons c on c.return_inspection_id=i.id
        where i.contract_id=v_t.contract_id
          and i.equipment_id=ca.equipment_id
          and i.termination_id=v_t.id
          and i.inspection_type='RETURN'
          and i.status='COMPLETED'
          and c.termination_id=v_t.id
     );

  select count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object(
           'comparison_id',c.id,
           'equipment_id',a.id,
           'inventory_number',a.inventory_number,
           'equipment_name',a.name,
           'brand',a.brand,
           'model',a.model,
           'serial_number',a.serial_number,
           'material_change',c.material_change,
           'document_id',c.document_id,
           'partner_response_status',lr.response_status,
           'partner_response_comment',lr.comment
         ) order by a.inventory_number,a.name),'[]'::jsonb)
    into v_open_comparisons,v_open_comparison_items
    from public.equipment_condition_comparisons c
    join public.equipment_assets a on a.id=c.equipment_id
    left join lateral (
      select r.response_status,r.comment
        from public.equipment_condition_comparison_responses r
       where r.comparison_id=c.id
       order by r.event_sequence desc
       limit 1
    ) lr on true
   where c.termination_id=v_t.id
     and c.comparison_status='OPEN';

  return jsonb_build_object(
    'termination_id',v_t.id,
    'contract_id',v_t.contract_id,
    'termination_status',v_t.status,
    'effective_end_date',v_t.effective_end_date,
    'date_reached',current_date>=v_t.effective_end_date,
    'equipment_count',v_equipment_count,
    'completed_return_inspections_count',v_completed_returns,
    'missing_return_inspections_count',v_missing_returns,
    'missing_return_inspections',v_missing_return_items,
    'missing_condition_comparisons_count',v_missing_comparisons,
    'missing_condition_comparisons',v_missing_comparison_items,
    'open_condition_comparisons_count',v_open_comparisons,
    'open_condition_comparisons',v_open_comparison_items,
    'condition_gate_clear',(v_missing_returns=0 and v_missing_comparisons=0 and v_open_comparisons=0),
    'can_finalize_condition',(current_date>=v_t.effective_end_date and v_missing_returns=0 and v_missing_comparisons=0 and v_open_comparisons=0)
  );
end
$$;
revoke all on function public.get_equipment_contract_termination_condition_preflight(uuid) from public,anon,authenticated;
grant execute on function public.get_equipment_contract_termination_condition_preflight(uuid) to authenticated;

create or replace function public.guard_equipment_termination_condition_comparisons()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_count integer;
begin
  if new.status='COMPLETED' and old.status is distinct from 'COMPLETED' then
    select count(*)::integer into v_count
      from public.equipment_contract_assets ca
     where ca.contract_id=new.contract_id
       and exists(
         select 1 from public.equipment_condition_inspections i
          where i.contract_id=new.contract_id
            and i.equipment_id=ca.equipment_id
            and i.termination_id=new.id
            and i.inspection_type='RETURN'
            and i.status='COMPLETED'
       )
       and not exists(
         select 1
           from public.equipment_condition_inspections i
           join public.equipment_condition_comparisons c on c.return_inspection_id=i.id
          where i.contract_id=new.contract_id
            and i.equipment_id=ca.equipment_id
            and i.termination_id=new.id
            and i.inspection_type='RETURN'
            and i.status='COMPLETED'
            and c.termination_id=new.id
       );
    if v_count>0 then raise exception 'CONDITION_COMPARISON_REQUIRED:%',v_count; end if;

    select count(*)::integer into v_count
      from public.equipment_condition_comparisons c
     where c.termination_id=new.id
       and c.comparison_status='OPEN';
    if v_count>0 then raise exception 'CONDITION_COMPARISON_RESOLUTION_REQUIRED:%',v_count; end if;
  end if;
  return new;
end
$$;
revoke all on function public.guard_equipment_termination_condition_comparisons() from public,anon,authenticated;

drop trigger if exists trg_guard_equipment_termination_condition_comparisons on public.equipment_contract_terminations;
create trigger trg_guard_equipment_termination_condition_comparisons
before update of status on public.equipment_contract_terminations
for each row execute function public.guard_equipment_termination_condition_comparisons();

create or replace function public.finalize_equipment_contract_termination(
  p_termination_id uuid,
  p_return_reference text,
  p_financial_clearance_reference text,
  p_document_id uuid default null,
  p_final_notes text default null
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_t public.equipment_contract_terminations%rowtype;
  v_contract public.equipment_contracts%rowtype;
  v_actor uuid:=public.current_staff_user_id();
  v_count integer;
begin
  if not public.has_permission('equipment.contracts.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if nullif(btrim(coalesce(p_return_reference,'')),'') is null then raise exception 'RETURN_REFERENCE_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_financial_clearance_reference,'')),'') is null then raise exception 'FINANCIAL_CLEARANCE_REQUIRED'; end if;

  select * into v_t
    from public.equipment_contract_terminations
   where id=p_termination_id
   for update;
  if v_t.id is null then raise exception 'TERMINATION_NOT_FOUND'; end if;
  if v_t.status in ('COMPLETED','CANCELLED') then raise exception 'TERMINATION_FINAL'; end if;
  if current_date<v_t.effective_end_date then raise exception 'TERMINATION_DATE_NOT_REACHED'; end if;

  select * into v_contract
    from public.equipment_contracts
   where id=v_t.contract_id
   for update;
  if v_contract.id is null then raise exception 'CONTRACT_NOT_FOUND'; end if;
  if v_contract.status not in ('ACTIVE','SUSPENDED') then raise exception 'CONTRACT_NOT_TERMINABLE'; end if;

  if p_document_id is not null
     and not exists(select 1 from public.documents where id=p_document_id)
  then raise exception 'DOCUMENT_NOT_FOUND'; end if;

  select count(*)::integer into v_count
    from public.equipment_contract_assets ca
   where ca.contract_id=v_contract.id
     and not exists(
       select 1 from public.equipment_condition_inspections i
        where i.contract_id=v_contract.id
          and i.equipment_id=ca.equipment_id
          and i.termination_id=v_t.id
          and i.inspection_type='RETURN'
          and i.status='COMPLETED'
     );
  if v_count>0 then raise exception 'RETURN_INSPECTION_REQUIRED:%',v_count; end if;

  select count(*)::integer into v_count
    from public.equipment_contract_assets ca
   where ca.contract_id=v_contract.id
     and exists(
       select 1 from public.equipment_condition_inspections i
        where i.contract_id=v_contract.id
          and i.equipment_id=ca.equipment_id
          and i.termination_id=v_t.id
          and i.inspection_type='RETURN'
          and i.status='COMPLETED'
     )
     and not exists(
       select 1
         from public.equipment_condition_inspections i
         join public.equipment_condition_comparisons c on c.return_inspection_id=i.id
        where i.contract_id=v_contract.id
          and i.equipment_id=ca.equipment_id
          and i.termination_id=v_t.id
          and i.inspection_type='RETURN'
          and i.status='COMPLETED'
          and c.termination_id=v_t.id
     );
  if v_count>0 then raise exception 'CONDITION_COMPARISON_REQUIRED:%',v_count; end if;

  select count(*)::integer into v_count
    from public.equipment_condition_comparisons c
   where c.termination_id=v_t.id
     and c.comparison_status='OPEN';
  if v_count>0 then raise exception 'CONDITION_COMPARISON_RESOLUTION_REQUIRED:%',v_count; end if;

  update public.equipment_contract_terminations
     set status='READY',
         return_reference=btrim(p_return_reference),
         financial_clearance_reference=btrim(p_financial_clearance_reference),
         final_notes=nullif(btrim(coalesce(p_final_notes,'')),'')
   where id=v_t.id;

  update public.equipment_contract_assets
     set ends_on=v_t.effective_end_date
   where contract_id=v_contract.id
     and (ends_on is null or ends_on>v_t.effective_end_date);

  update public.equipment_assets a
     set operational_status='OFFLINE',updated_at=clock_timestamp()
   where a.id in (
     select ca.equipment_id from public.equipment_contract_assets ca where ca.contract_id=v_contract.id
   )
     and a.current_owner_partner_id=v_contract.partner_id
     and a.ownership_type in ('PARTNER','LEASE','LEASE_BUYOUT')
     and not exists(
       select 1
         from public.equipment_contract_assets ca2
         join public.equipment_contracts c2 on c2.id=ca2.contract_id
        where ca2.equipment_id=a.id
          and c2.id<>v_contract.id
          and c2.status='ACTIVE'
          and coalesce(ca2.starts_on,c2.starts_on)<=v_t.effective_end_date
          and (ca2.ends_on is null or ca2.ends_on>=v_t.effective_end_date)
     );

  update public.equipment_contracts
     set status='TERMINATED',ends_on=v_t.effective_end_date,updated_at=clock_timestamp()
   where id=v_contract.id;

  if p_document_id is not null then
    insert into public.document_links(document_id,entity_type,entity_id,relationship)
    select p_document_id,'EQUIPMENT_CONTRACT_TERMINATION',v_t.id,'RETURN_ACT'
     where not exists(
       select 1 from public.document_links dl
        where dl.document_id=p_document_id
          and dl.entity_type='EQUIPMENT_CONTRACT_TERMINATION'
          and dl.entity_id=v_t.id
          and dl.relationship='RETURN_ACT'
     );
  end if;

  update public.equipment_contract_terminations
     set status='COMPLETED',completed_by=v_actor,completed_at=clock_timestamp()
   where id=v_t.id;

  perform public.notify_equipment_contract_termination(v_t.id,'COMPLETED');
  return v_t.id;
end
$$;
revoke all on function public.finalize_equipment_contract_termination(uuid,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.finalize_equipment_contract_termination(uuid,text,text,uuid,text) to authenticated;
