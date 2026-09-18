-- A4PRINT HUB: Production Farm Phase 47 — composition annex condition handoff.
-- ADD requires completed ACCEPTANCE. REMOVE requires completed RETURN + resolved/non-open comparison.

alter table public.equipment_condition_inspections
  add column composition_amendment_asset_id uuid
  references public.equipment_contract_amendment_assets(id) on delete restrict;

create unique index equipment_condition_inspections_composition_change_uidx
  on public.equipment_condition_inspections(composition_amendment_asset_id)
  where composition_amendment_asset_id is not null;

create index equipment_condition_inspections_composition_change_idx
  on public.equipment_condition_inspections(composition_amendment_asset_id,status);

CREATE OR REPLACE FUNCTION public.prepare_equipment_composition_inspections(p_amendment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_a public.equipment_contract_amendments%rowtype;
  v_change public.equipment_contract_amendment_assets%rowtype;
  v_actor uuid;
  v_type text;
  v_id uuid;
  v_created integer:=0;
  v_comp_note text;
  v_checklist jsonb;
  v_result jsonb;
begin
  perform private.assert_non_partner_staff_context();
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not (
    public.has_permission('equipment.manage')
    or public.has_permission('equipment.contracts.manage')
  ) then raise exception 'PERMISSION_DENIED'; end if;

  select * into v_a
  from public.equipment_contract_amendments
  where id=p_amendment_id
  for share;

  if v_a.id is null then raise exception 'AMENDMENT_NOT_FOUND'; end if;
  perform private.assert_equipment_contract_tenant(v_a.contract_id);

  if v_a.amendment_kind<>'EQUIPMENT_COMPOSITION' then
    raise exception 'COMPOSITION_AMENDMENT_REQUIRED';
  end if;
  if v_a.status<>'APPROVED' then
    raise exception 'COMPOSITION_AMENDMENT_MUST_BE_APPROVED';
  end if;

  v_actor:=public.current_staff_user_id();
  if v_actor is null then raise exception 'STAFF_USER_NOT_FOUND'; end if;

  for v_change in
    select *
    from public.equipment_contract_amendment_assets
    where amendment_id=v_a.id
    order by created_at,id
  loop
    select i.id into v_id
    from public.equipment_condition_inspections i
    where i.composition_amendment_asset_id=v_change.id
    limit 1;

    if v_id is not null then
      continue;
    end if;

    v_type:=case when v_change.change_action='ADD' then 'ACCEPTANCE' else 'RETURN' end;

    if exists(
      select 1
      from public.equipment_condition_inspections i
      where i.contract_id=v_change.contract_id
        and i.equipment_id=v_change.equipment_id
        and i.inspection_type=v_type
        and i.status='DRAFT'
    ) then
      raise exception 'COMPOSITION_INSPECTION_DRAFT_CONFLICT:%',v_change.equipment_id;
    end if;

    select string_agg(
      case
        when jsonb_typeof(x.value)='string' then x.value #>> '{}'
        else coalesce(
          x.value->>'label',
          x.value->>'name',
          x.value->>'item',
          x.value->>'reference',
          x.value::text
        )
      end,
      '; ' order by x.ord
    )
    into v_comp_note
    from jsonb_array_elements(v_change.completeness) with ordinality x(value,ord);

    v_checklist:=jsonb_build_array(
      jsonb_build_object('key','visual','label','Внешний вид и корпус','result','PASS','note',null),
      jsonb_build_object('key','power','label','Включение / питание','result','PASS','note',null),
      jsonb_build_object('key','mechanics','label','Механика / движение','result','PASS','note',null),
      jsonb_build_object('key','safety','label','Защита и безопасность','result','PASS','note',null),
      jsonb_build_object(
        'key','accessories',
        'label','Комплектность / оснастка',
        'result','PASS',
        'note',nullif(v_comp_note,'')
      )
    );

    insert into public.equipment_condition_inspections(
      equipment_id,contract_id,partner_id,termination_id,
      inspection_type,status,inspected_on,location,meter_hours,
      condition_grade,operational_state,checklist,defects,notes,
      composition_amendment_asset_id,created_by
    ) values(
      v_change.equipment_id,v_change.contract_id,v_change.partner_id,null,
      v_type,'DRAFT',v_a.effective_on,null,v_change.meter_hours,
      v_change.condition_grade,v_change.operational_state,v_checklist,'[]'::jsonb,
      concat_ws(
        E'\n',
        'Осмотр по ДС '||v_a.amendment_number||
          ' · '||case when v_change.change_action='ADD' then 'добавление' else 'вывод' end,
        v_change.note
      ),
      v_change.id,v_actor
    );

    v_created:=v_created+1;
  end loop;

  select jsonb_build_object(
    'amendment_id',v_a.id,
    'amendment_number',v_a.amendment_number,
    'created_count',v_created,
    'items',coalesce(jsonb_agg(
      jsonb_build_object(
        'amendment_asset_id',x.id,
        'change_action',x.change_action,
        'equipment_id',x.equipment_id,
        'inventory_number',ea.inventory_number,
        'equipment_name',ea.name,
        'inspection_id',i.id,
        'inspection_type',i.inspection_type,
        'inspection_status',i.status,
        'inspected_on',i.inspected_on,
        'comparison_id',cc.id,
        'comparison_status',cc.comparison_status
      )
      order by x.created_at,x.id
    ),'[]'::jsonb)
  )
  into v_result
  from public.equipment_contract_amendment_assets x
  join public.equipment_assets ea on ea.id=x.equipment_id
  left join public.equipment_condition_inspections i
    on i.composition_amendment_asset_id=x.id
  left join public.equipment_condition_comparisons cc
    on cc.return_inspection_id=i.id
  where x.amendment_id=v_a.id;

  return v_result;
end
$function$;

revoke all on function public.prepare_equipment_composition_inspections(uuid)
from public,anon,authenticated;
grant execute on function public.prepare_equipment_composition_inspections(uuid)
to authenticated;

CREATE OR REPLACE FUNCTION public.save_equipment_condition_inspection(p_inspection_id uuid, p_contract_id uuid, p_equipment_id uuid, p_inspection_type text, p_termination_id uuid DEFAULT NULL::uuid, p_inspected_on date DEFAULT CURRENT_DATE, p_location text DEFAULT NULL::text, p_meter_hours numeric DEFAULT NULL::numeric, p_condition_grade text DEFAULT 'GOOD'::text, p_operational_state text DEFAULT 'READY'::text, p_checklist jsonb DEFAULT '[]'::jsonb, p_defects jsonb DEFAULT '[]'::jsonb, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_type text:=upper(btrim(coalesce(p_inspection_type,'')));
  v_grade text:=upper(btrim(coalesce(p_condition_grade,'')));
  v_state text:=upper(btrim(coalesce(p_operational_state,'')));
  v_partner_id uuid;
  v_actor uuid;
  v_id uuid;
  v_existing_status text;
  v_comp_asset_id uuid;
  v_comp_action text;
  v_comp_contract_id uuid;
  v_comp_equipment_id uuid;
  v_comp_effective_on date;
  v_comp_status text;
  v_expected_type text;
begin
  perform private.assert_no_partner_context();
  perform private.assert_equipment_contract_tenant(p_contract_id);

  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_permission('equipment.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if p_contract_id is null or p_equipment_id is null then
    raise exception 'CONTRACT_AND_EQUIPMENT_REQUIRED';
  end if;
  if v_type not in ('ACCEPTANCE','RETURN','PERIODIC') then
    raise exception 'INVALID_INSPECTION_TYPE';
  end if;
  if v_grade not in ('EXCELLENT','GOOD','FAIR','POOR','NON_OPERATIONAL') then
    raise exception 'INVALID_CONDITION_GRADE';
  end if;
  if v_state not in ('READY','LIMITED','NOT_OPERATIONAL') then
    raise exception 'INVALID_OPERATIONAL_STATE';
  end if;
  if p_meter_hours is not null and p_meter_hours<0 then
    raise exception 'INVALID_METER_HOURS';
  end if;

  perform public.validate_equipment_condition_checklist(p_checklist);
  if p_defects is null or jsonb_typeof(p_defects)<>'array' then
    raise exception 'INVALID_DEFECTS';
  end if;

  if p_inspection_id is not null then
    select i.status,i.composition_amendment_asset_id
      into v_existing_status,v_comp_asset_id
    from public.equipment_condition_inspections i
    where i.id=p_inspection_id
    for update;

    if v_existing_status is null then raise exception 'INSPECTION_NOT_FOUND'; end if;
    if v_existing_status<>'DRAFT' then raise exception 'INSPECTION_NOT_EDITABLE'; end if;

    if v_comp_asset_id is not null then
      select x.change_action,x.contract_id,x.equipment_id,a.effective_on,a.status
        into v_comp_action,v_comp_contract_id,v_comp_equipment_id,
             v_comp_effective_on,v_comp_status
      from public.equipment_contract_amendment_assets x
      join public.equipment_contract_amendments a on a.id=x.amendment_id
      where x.id=v_comp_asset_id;

      if v_comp_contract_id is null then
        raise exception 'COMPOSITION_CHANGE_NOT_FOUND';
      end if;
      if v_comp_status<>'APPROVED' then
        raise exception 'COMPOSITION_AMENDMENT_NOT_EDITABLE';
      end if;
      if p_contract_id is distinct from v_comp_contract_id
         or p_equipment_id is distinct from v_comp_equipment_id then
        raise exception 'COMPOSITION_INSPECTION_SCOPE_IMMUTABLE';
      end if;

      v_expected_type:=case when v_comp_action='ADD' then 'ACCEPTANCE' else 'RETURN' end;

      if v_type<>v_expected_type then
        raise exception 'COMPOSITION_INSPECTION_TYPE_IMMUTABLE';
      end if;
      if p_termination_id is not null then
        raise exception 'COMPOSITION_INSPECTION_TERMINATION_NOT_ALLOWED';
      end if;
      if coalesce(p_inspected_on,current_date) is distinct from v_comp_effective_on then
        raise exception 'COMPOSITION_INSPECTION_DATE_MUST_MATCH_AMENDMENT';
      end if;
    end if;
  end if;

  select c.partner_id into v_partner_id
  from public.equipment_contracts c
  where c.id=p_contract_id;

  if v_partner_id is null then raise exception 'CONTRACT_NOT_FOUND'; end if;

  if v_comp_asset_id is null then
    if not exists(
      select 1
      from public.equipment_contract_assets ca
      where ca.contract_id=p_contract_id
        and ca.equipment_id=p_equipment_id
    ) then
      raise exception 'EQUIPMENT_NOT_IN_CONTRACT';
    end if;

    if v_type='RETURN' then
      if p_termination_id is null then
        raise exception 'TERMINATION_REQUIRED_FOR_RETURN';
      end if;
      if not exists(
        select 1
        from public.equipment_contract_terminations t
        where t.id=p_termination_id
          and t.contract_id=p_contract_id
          and t.partner_id=v_partner_id
          and t.status in ('NOTICE','PREPARING','READY')
      ) then
        raise exception 'TERMINATION_NOT_AVAILABLE_FOR_RETURN';
      end if;
    elsif p_termination_id is not null then
      raise exception 'TERMINATION_ONLY_FOR_RETURN';
    end if;
  end if;

  v_actor:=public.current_staff_user_id();
  if v_actor is null then raise exception 'STAFF_USER_NOT_FOUND'; end if;

  if p_inspection_id is null then
    insert into public.equipment_condition_inspections(
      equipment_id,contract_id,partner_id,termination_id,
      inspection_type,status,inspected_on,location,meter_hours,
      condition_grade,operational_state,checklist,defects,notes,created_by
    ) values(
      p_equipment_id,p_contract_id,v_partner_id,p_termination_id,
      v_type,'DRAFT',coalesce(p_inspected_on,current_date),
      nullif(btrim(coalesce(p_location,'')),''),p_meter_hours,
      v_grade,v_state,p_checklist,p_defects,
      nullif(btrim(coalesce(p_notes,'')),''),v_actor
    )
    returning id into v_id;
  else
    update public.equipment_condition_inspections
    set equipment_id=p_equipment_id,
        contract_id=p_contract_id,
        partner_id=v_partner_id,
        termination_id=case when v_comp_asset_id is null then p_termination_id else null end,
        inspection_type=v_type,
        inspected_on=coalesce(p_inspected_on,current_date),
        location=nullif(btrim(coalesce(p_location,'')),''),
        meter_hours=p_meter_hours,
        condition_grade=v_grade,
        operational_state=v_state,
        checklist=p_checklist,
        defects=p_defects,
        notes=nullif(btrim(coalesce(p_notes,'')),'')
    where id=p_inspection_id;

    v_id:=p_inspection_id;
  end if;

  return v_id;
end
$function$;

revoke all on function public.save_equipment_condition_inspection(
  uuid,uuid,uuid,text,uuid,date,text,numeric,text,text,jsonb,jsonb,text
) from public,anon,authenticated;
grant execute on function public.save_equipment_condition_inspection(
  uuid,uuid,uuid,text,uuid,date,text,numeric,text,text,jsonb,jsonb,text
) to authenticated;

CREATE OR REPLACE FUNCTION public.guard_equipment_composition_inspection_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_change public.equipment_contract_amendment_assets%rowtype;
  v_a public.equipment_contract_amendments%rowtype;
  v_expected_type text;
begin
  if new.status<>'COMPLETED'
     or old.status='COMPLETED'
     or new.composition_amendment_asset_id is null then
    return new;
  end if;

  select * into v_change
  from public.equipment_contract_amendment_assets
  where id=new.composition_amendment_asset_id;

  if v_change.id is null then raise exception 'COMPOSITION_CHANGE_NOT_FOUND'; end if;

  select * into v_a
  from public.equipment_contract_amendments
  where id=v_change.amendment_id;

  if v_a.id is null then raise exception 'AMENDMENT_NOT_FOUND'; end if;
  if v_a.status<>'APPROVED' then
    raise exception 'COMPOSITION_AMENDMENT_NOT_READY_FOR_INSPECTION';
  end if;

  v_expected_type:=case when v_change.change_action='ADD' then 'ACCEPTANCE' else 'RETURN' end;

  if new.contract_id is distinct from v_change.contract_id
     or new.partner_id is distinct from v_change.partner_id
     or new.equipment_id is distinct from v_change.equipment_id then
    raise exception 'COMPOSITION_INSPECTION_SCOPE_MISMATCH';
  end if;

  if new.inspection_type<>v_expected_type then
    raise exception 'COMPOSITION_INSPECTION_TYPE_MISMATCH';
  end if;

  if new.termination_id is not null then
    raise exception 'COMPOSITION_INSPECTION_TERMINATION_NOT_ALLOWED';
  end if;

  if new.inspected_on is distinct from v_a.effective_on then
    raise exception 'COMPOSITION_INSPECTION_DATE_MUST_MATCH_AMENDMENT';
  end if;

  if new.condition_grade is distinct from v_change.condition_grade
     or new.operational_state is distinct from v_change.operational_state
     or new.meter_hours is distinct from v_change.meter_hours then
    raise exception 'COMPOSITION_INSPECTION_AMENDMENT_MISMATCH';
  end if;

  new.completion_snapshot:=coalesce(new.completion_snapshot,'{}'::jsonb)
    ||jsonb_build_object(
      'composition_amendment_id',v_a.id,
      'composition_amendment_number',v_a.amendment_number,
      'composition_amendment_asset_id',v_change.id,
      'composition_change_action',v_change.change_action
    );

  return new;
end
$function$;

revoke all on function public.guard_equipment_composition_inspection_completion()
from public,anon,authenticated;

drop trigger if exists trg_guard_equipment_composition_inspection_completion
on public.equipment_condition_inspections;
create trigger trg_guard_equipment_composition_inspection_completion
before update of status
on public.equipment_condition_inspections
for each row execute function public.guard_equipment_composition_inspection_completion();

CREATE OR REPLACE FUNCTION public.link_equipment_composition_inspection_document()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_change public.equipment_contract_amendment_assets%rowtype;
begin
  if new.status<>'COMPLETED'
     or old.status='COMPLETED'
     or new.composition_amendment_asset_id is null
     or new.document_id is null then
    return new;
  end if;

  select * into v_change
  from public.equipment_contract_amendment_assets
  where id=new.composition_amendment_asset_id;

  if v_change.id is null then return new; end if;

  insert into public.document_links(
    document_id,entity_type,entity_id,relationship,created_at
  ) values(
    new.document_id,'EQUIPMENT_CONTRACT_AMENDMENT_ASSET',
    v_change.id,'COMPOSITION_INSPECTION',clock_timestamp()
  ) on conflict do nothing;

  insert into public.document_links(
    document_id,entity_type,entity_id,relationship,created_at
  ) values(
    new.document_id,'EQUIPMENT_CONTRACT_AMENDMENT',
    v_change.amendment_id,'COMPOSITION_INSPECTION',clock_timestamp()
  ) on conflict do nothing;

  update public.documents
  set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
    'composition_amendment_id',v_change.amendment_id,
    'composition_amendment_asset_id',v_change.id,
    'composition_change_action',v_change.change_action
  ),
  updated_at=clock_timestamp()
  where id=new.document_id;

  return new;
end
$function$;

revoke all on function public.link_equipment_composition_inspection_document()
from public,anon,authenticated;

drop trigger if exists trg_link_equipment_composition_inspection_document
on public.equipment_condition_inspections;
create trigger trg_link_equipment_composition_inspection_document
after update of status
on public.equipment_condition_inspections
for each row execute function public.link_equipment_composition_inspection_document();

CREATE OR REPLACE FUNCTION public.cancel_composition_inspection_drafts_after_amendment_cancel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status='CANCELLED'
     and old.status is distinct from 'CANCELLED'
     and new.amendment_kind='EQUIPMENT_COMPOSITION' then
    update public.equipment_condition_inspections i
    set status='CANCELLED',
        notes=concat_ws(
          E'\n',
          i.notes,
          'Отменено автоматически: отменено ДС '||new.amendment_number
        )
    where i.status='DRAFT'
      and exists(
        select 1
        from public.equipment_contract_amendment_assets x
        where x.id=i.composition_amendment_asset_id
          and x.amendment_id=new.id
      );
  end if;
  return new;
end
$function$;

revoke all on function public.cancel_composition_inspection_drafts_after_amendment_cancel()
from public,anon,authenticated;

drop trigger if exists trg_cancel_composition_inspection_drafts_after_amendment_cancel
on public.equipment_contract_amendments;
create trigger trg_cancel_composition_inspection_drafts_after_amendment_cancel
after update of status
on public.equipment_contract_amendments
for each row execute function public.cancel_composition_inspection_drafts_after_amendment_cancel();

CREATE OR REPLACE FUNCTION private.assert_equipment_composition_condition_ready(p_amendment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_a public.equipment_contract_amendments%rowtype;
  v_change public.equipment_contract_amendment_assets%rowtype;
  v_i public.equipment_condition_inspections%rowtype;
  v_comparison_status text;
  v_inventory text;
  v_expected_type text;
begin
  select * into v_a
  from public.equipment_contract_amendments
  where id=p_amendment_id;

  if v_a.id is null then raise exception 'AMENDMENT_NOT_FOUND'; end if;
  if v_a.amendment_kind<>'EQUIPMENT_COMPOSITION' then
    raise exception 'COMPOSITION_AMENDMENT_REQUIRED';
  end if;

  for v_change in
    select *
    from public.equipment_contract_amendment_assets
    where amendment_id=v_a.id
    order by created_at,id
  loop
    v_expected_type:=case when v_change.change_action='ADD' then 'ACCEPTANCE' else 'RETURN' end;

    select * into v_i
    from public.equipment_condition_inspections
    where composition_amendment_asset_id=v_change.id
      and inspection_type=v_expected_type
      and status='COMPLETED'
      and inspected_on=v_a.effective_on
    limit 1;

    select coalesce(a.inventory_number,a.name,v_change.equipment_id::text)
      into v_inventory
    from public.equipment_assets a
    where a.id=v_change.equipment_id;

    if v_i.id is null then
      raise exception 'COMPOSITION_INSPECTION_REQUIRED:%',v_inventory;
    end if;

    if v_i.condition_grade is distinct from v_change.condition_grade
       or v_i.operational_state is distinct from v_change.operational_state
       or v_i.meter_hours is distinct from v_change.meter_hours then
      raise exception 'COMPOSITION_INSPECTION_AMENDMENT_MISMATCH:%',v_inventory;
    end if;

    if v_change.change_action='REMOVE' then
      select c.comparison_status into v_comparison_status
      from public.equipment_condition_comparisons c
      where c.return_inspection_id=v_i.id;

      if v_comparison_status is null then
        raise exception 'COMPOSITION_COMPARISON_REQUIRED:%',v_inventory;
      end if;

      if v_comparison_status='OPEN' then
        raise exception 'COMPOSITION_COMPARISON_RESOLUTION_REQUIRED:%',v_inventory;
      end if;
    end if;
  end loop;
end
$function$;

revoke all on function private.assert_equipment_composition_condition_ready(uuid)
from public,anon,authenticated;

CREATE OR REPLACE FUNCTION private.apply_equipment_contract_composition_amendment(p_amendment_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_a public.equipment_contract_amendments%rowtype;
  v_contract public.equipment_contracts%rowtype;
  v_doc_status public.document_status;
  v_actor uuid;
  v_change public.equipment_contract_amendment_assets%rowtype;
  v_assignment_id uuid;
  v_new_asset_id uuid;
  v_after jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_permission('equipment.contracts.manage') then raise exception 'PERMISSION_DENIED'; end if;

  select * into v_a
  from public.equipment_contract_amendments
  where id=p_amendment_id
  for update;

  if v_a.id is null then raise exception 'AMENDMENT_NOT_FOUND'; end if;
  if v_a.amendment_kind<>'EQUIPMENT_COMPOSITION' then raise exception 'COMPOSITION_AMENDMENT_REQUIRED'; end if;
  if v_a.status<>'APPROVED' then raise exception 'AMENDMENT_NOT_APPROVED'; end if;
  if v_a.effective_on>current_date then raise exception 'AMENDMENT_NOT_EFFECTIVE_YET'; end if;

  perform private.assert_equipment_contract_tenant(v_a.contract_id);

  select * into v_contract
  from public.equipment_contracts
  where id=v_a.contract_id
  for update;

  if v_contract.id is null then raise exception 'CONTRACT_NOT_FOUND'; end if;
  if v_contract.status not in ('ACTIVE','SUSPENDED') then
    raise exception 'CONTRACT_NOT_ACTIVE_OR_SUSPENDED';
  end if;

  if public.equipment_contract_legal_snapshot(v_contract.id)
     is distinct from v_a.before_snapshot then
    raise exception 'CONTRACT_CHANGED_SINCE_DRAFT';
  end if;

  select status into v_doc_status
  from public.documents
  where id=v_a.document_id
  for update;

  if v_doc_status not in ('SIGNED'::public.document_status,'ACTIVE'::public.document_status) then
    raise exception 'AMENDMENT_DOCUMENT_MUST_BE_SIGNED';
  end if;

  perform private.assert_equipment_composition_condition_ready(v_a.id);

  perform set_config('app.equipment_contract_amendment_apply','1',true);

  for v_change in
    select *
    from public.equipment_contract_amendment_assets
    where amendment_id=v_a.id
      and change_action='REMOVE'
    order by created_at,id
  loop
    select ca.id into v_assignment_id
    from public.equipment_contract_assets ca
    where ca.contract_id=v_contract.id
      and ca.equipment_id=v_change.equipment_id
      and ca.starts_on<v_a.effective_on
      and v_a.effective_on<=coalesce(ca.ends_on,'infinity'::date)
    order by ca.starts_on desc
    limit 1
    for update;

    if v_assignment_id is null then
      raise exception 'COMPOSITION_CHANGED_SINCE_DRAFT:%',v_change.equipment_id;
    end if;

    update public.equipment_contract_assets
    set ends_on=v_a.effective_on-1,
        ended_by_amendment_id=v_a.id
    where id=v_assignment_id;

    update public.equipment_contract_amendment_assets
    set contract_asset_id=v_assignment_id
    where id=v_change.id;
  end loop;

  for v_change in
    select *
    from public.equipment_contract_amendment_assets
    where amendment_id=v_a.id
      and change_action='ADD'
    order by created_at,id
  loop
    if exists(
      select 1
      from public.equipment_contract_assets ca
      where ca.contract_id=v_contract.id
        and ca.equipment_id=v_change.equipment_id
        and ca.starts_on<=coalesce(v_contract.ends_on,'infinity'::date)
        and v_a.effective_on<=coalesce(ca.ends_on,'infinity'::date)
    ) then
      raise exception 'COMPOSITION_CHANGED_SINCE_DRAFT:%',v_change.equipment_id;
    end if;

    if not exists(
      select 1
      from public.equipment_assets ea
      where ea.id=v_change.equipment_id
        and ea.organization_id=v_contract.organization_id
        and ea.status<>'WRITTEN_OFF'
    ) then
      raise exception 'EQUIPMENT_NOT_AVAILABLE:%',v_change.equipment_id;
    end if;

    insert into public.equipment_contract_assets(
      contract_id,equipment_id,starts_on,ends_on,source_amendment_id
    ) values(
      v_contract.id,v_change.equipment_id,v_a.effective_on,
      v_contract.ends_on,v_a.id
    )
    returning id into v_new_asset_id;

    update public.equipment_contract_amendment_assets
    set contract_asset_id=v_new_asset_id
    where id=v_change.id;
  end loop;

  v_after:=public.equipment_contract_legal_snapshot(v_contract.id);
  v_actor:=public.current_staff_user_id();

  update public.equipment_contract_amendments
  set status='APPLIED',
      after_snapshot=v_after,
      applied_by=v_actor,
      applied_at=clock_timestamp()
  where id=v_a.id;

  if v_doc_status='SIGNED'::public.document_status then
    update public.documents
    set status='ACTIVE'::public.document_status,
        updated_at=clock_timestamp()
    where id=v_a.document_id;

    insert into public.document_status_history(
      document_id,old_status,new_status,changed_by,comment
    ) values(
      v_a.document_id,v_doc_status,'ACTIVE'::public.document_status,
      v_actor,'Изменение состава оборудования применено к договору'
    );
  end if;

  return v_a.id;
end
$function$;

revoke all on function private.apply_equipment_contract_composition_amendment(uuid)
from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.ensure_equipment_condition_comparison(p_return_inspection_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_org uuid;
  v_amendment_asset_id uuid;
  v_amendment_id uuid;
begin
  select * into v_ret
  from public.equipment_condition_inspections
  where id=p_return_inspection_id
    and inspection_type='RETURN'
    and status='COMPLETED';

  if v_ret.id is null then
    raise exception 'COMPLETED_RETURN_INSPECTION_REQUIRED';
  end if;

  select id into v_id
  from public.equipment_condition_comparisons
  where return_inspection_id=v_ret.id;

  if v_id is not null then return v_id; end if;

  v_delta:=public.build_equipment_condition_delta(v_ret.id);
  v_acc_id:=nullif(v_delta->>'acceptance_inspection_id','')::uuid;
  v_material:=coalesce((v_delta->>'material_change')::boolean,false);
  v_status:=case
    when coalesce((v_delta->>'baseline_missing')::boolean,false) then 'NO_BASELINE'
    when v_material then 'OPEN'
    else 'NO_DISCREPANCY'
  end;

  v_actor:=coalesce(v_ret.completed_by,public.current_staff_user_id());
  if v_actor is null then raise exception 'STAFF_USER_NOT_FOUND'; end if;

  insert into public.equipment_condition_comparisons(
    contract_id,equipment_id,partner_id,termination_id,
    acceptance_inspection_id,return_inspection_id,
    comparison_status,material_change,delta_snapshot,created_by
  ) values(
    v_ret.contract_id,v_ret.equipment_id,v_ret.partner_id,v_ret.termination_id,
    v_acc_id,v_ret.id,v_status,v_material,v_delta,v_actor
  )
  returning id into v_id;

  select id into v_doc_type
  from public.document_types
  where code='EQ_CONDITION_COMPARISON';

  if v_doc_type is null then raise exception 'DOCUMENT_TYPE_NOT_FOUND'; end if;

  v_number:='CMP-'||to_char(v_ret.inspected_on,'YYYYMMDD')||
    '-'||upper(substr(v_id::text,1,8));

  select
    'Сверка состояния · '||coalesce(a.inventory_number,a.name,'оборудование'),
    a.organization_id
    into v_title,v_org
  from public.equipment_assets a
  where a.id=v_ret.equipment_id;

  insert into public.documents(
    document_type_id,document_number,title,status,business_unit,
    issue_date,created_by,metadata,created_at,updated_at
  ) values(
    v_doc_type,v_number,v_title,'ACTIVE'::public.document_status,
    'COMMON'::public.business_unit,v_ret.inspected_on,v_actor,
    jsonb_build_object(
      'schema_version',1,
      'comparison_id',v_id,
      'comparison_status',v_status,
      'material_change',v_material,
      'delta',v_delta,
      'composition_amendment_asset_id',v_ret.composition_amendment_asset_id
    ),
    clock_timestamp(),clock_timestamp()
  )
  returning id into v_doc;

  update public.equipment_condition_comparisons
  set document_id=v_doc
  where id=v_id;

  insert into public.document_links(
    document_id,entity_type,entity_id,relationship,created_at
  ) values(
    v_doc,'EQUIPMENT_CONDITION_COMPARISON',v_id,'SOURCE',clock_timestamp()
  ) on conflict do nothing;

  insert into public.document_links(
    document_id,entity_type,entity_id,relationship,created_at
  ) values(
    v_doc,'EQUIPMENT_CONDITION_INSPECTION',v_ret.id,'RETURN',clock_timestamp()
  ) on conflict do nothing;

  if v_acc_id is not null then
    insert into public.document_links(
      document_id,entity_type,entity_id,relationship,created_at
    ) values(
      v_doc,'EQUIPMENT_CONDITION_INSPECTION',v_acc_id,'ACCEPTANCE',clock_timestamp()
    ) on conflict do nothing;
  end if;

  insert into public.document_links(
    document_id,entity_type,entity_id,relationship,created_at
  ) values(
    v_doc,'EQUIPMENT_ASSET',v_ret.equipment_id,'CONDITION_COMPARISON',clock_timestamp()
  ) on conflict do nothing;

  insert into public.document_links(
    document_id,entity_type,entity_id,relationship,created_at
  ) values(
    v_doc,'EQUIPMENT_CONTRACT',v_ret.contract_id,'CONDITION_COMPARISON',clock_timestamp()
  ) on conflict do nothing;

  insert into public.document_links(
    document_id,entity_type,entity_id,relationship,created_at
  ) values(
    v_doc,'PARTNER',v_ret.partner_id,'CONDITION_COMPARISON',clock_timestamp()
  ) on conflict do nothing;

  if v_ret.termination_id is not null then
    insert into public.document_links(
      document_id,entity_type,entity_id,relationship,created_at
    ) values(
      v_doc,'EQUIPMENT_CONTRACT_TERMINATION',
      v_ret.termination_id,'CONDITION_COMPARISON',clock_timestamp()
    ) on conflict do nothing;
  end if;

  if v_ret.composition_amendment_asset_id is not null then
    v_amendment_asset_id:=v_ret.composition_amendment_asset_id;

    select x.amendment_id into v_amendment_id
    from public.equipment_contract_amendment_assets x
    where x.id=v_amendment_asset_id;

    insert into public.document_links(
      document_id,entity_type,entity_id,relationship,created_at
    ) values(
      v_doc,'EQUIPMENT_CONTRACT_AMENDMENT_ASSET',
      v_amendment_asset_id,'CONDITION_COMPARISON',clock_timestamp()
    ) on conflict do nothing;

    if v_amendment_id is not null then
      insert into public.document_links(
        document_id,entity_type,entity_id,relationship,created_at
      ) values(
        v_doc,'EQUIPMENT_CONTRACT_AMENDMENT',
        v_amendment_id,'CONDITION_COMPARISON',clock_timestamp()
      ) on conflict do nothing;
    end if;
  end if;

  if v_status='OPEN' then
    insert into public.notifications(
      user_id,title,body,type,entity_type,entity_id
    )
    select distinct
      u.id,
      'Обнаружены изменения состояния оборудования',
      v_title||' · требуется сверка',
      'WARNING',
      'EQUIPMENT_CONDITION_COMPARISON',
      v_id
    from public.users u
    join public.organization_units ou
      on ou.id=u.organization_unit_id
     and ou.is_active=true
     and ou.organization_id=v_org
    join public.user_roles ur on ur.user_id=u.id
    join public.roles ro on ro.id=ur.role_id
    left join public.role_permissions rp on rp.role_id=ro.id
    left join public.permissions pp on pp.id=rp.permission_id
    where u.is_active=true
      and (
        ro.name='ADMIN'
        or pp.code in ('equipment.manage','equipment.contracts.manage')
      );
  end if;

  return v_id;
end
$function$;

revoke all on function public.ensure_equipment_condition_comparison(uuid)
from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.list_equipment_condition_inspections(p_include_cancelled boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
begin
  if not (
    public.has_permission('equipment.view')
    or public.has_permission('equipment.manage')
    or public.has_permission('equipment.contracts.manage')
  ) then raise exception 'PERMISSION_DENIED'; end if;

  select coalesce(
    jsonb_agg(to_jsonb(x) order by x.inspected_on desc,x.created_at desc),
    '[]'::jsonb
  )
  into v_result
  from (
    select
      i.id inspection_id,
      i.inspection_type,
      i.status,
      i.inspected_on,
      i.location,
      i.meter_hours,
      i.condition_grade,
      i.operational_state,
      i.checklist,
      i.defects,
      i.notes,
      i.contract_id,
      c.contract_number,
      i.partner_id,
      coalesce(p.legal_name,p.name) partner_name,
      i.equipment_id,
      a.inventory_number,
      a.name equipment_name,
      a.brand,
      a.model,
      a.serial_number,
      i.termination_id,
      i.composition_amendment_asset_id,
      caa.amendment_id composition_amendment_id,
      caa.change_action composition_change_action,
      cam.amendment_number composition_amendment_number,
      cam.effective_on composition_effective_on,
      i.document_id,
      d.document_number,
      i.created_at,
      i.completed_at,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id',f.id,
            'file_kind',f.file_kind,
            'file_name',f.file_name,
            'mime_type',f.mime_type,
            'file_size',f.file_size,
            'storage_path',f.storage_path,
            'caption',f.caption,
            'created_at',f.created_at
          )
          order by f.created_at
        )
        from public.equipment_condition_inspection_files f
        where f.inspection_id=i.id
      ),'[]'::jsonb) files
    from public.equipment_condition_inspections i
    join public.equipment_contracts c on c.id=i.contract_id
    join public.partners p on p.id=i.partner_id
    join public.equipment_assets a on a.id=i.equipment_id
    left join public.equipment_contract_amendment_assets caa
      on caa.id=i.composition_amendment_asset_id
    left join public.equipment_contract_amendments cam
      on cam.id=caa.amendment_id
    left join public.documents d on d.id=i.document_id
    where coalesce(p_include_cancelled,false)
       or i.status<>'CANCELLED'
  ) x;

  return v_result;
end
$function$;

revoke all on function public.list_equipment_condition_inspections(boolean)
from public,anon,authenticated;
grant execute on function public.list_equipment_condition_inspections(boolean)
to authenticated;

CREATE OR REPLACE FUNCTION public.get_my_equipment_condition_inspections()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_partner_id uuid;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  v_partner_id:=public.current_partner_id();
  if v_partner_id is null then raise exception 'PARTNER_ACCESS_REQUIRED'; end if;

  select coalesce(
    jsonb_agg(to_jsonb(x) order by x.inspected_on desc,x.completed_at desc),
    '[]'::jsonb
  )
  into v_result
  from (
    select
      i.id inspection_id,
      i.inspection_type,
      i.inspected_on,
      i.location,
      i.meter_hours,
      i.condition_grade,
      i.operational_state,
      i.checklist,
      i.defects,
      i.notes,
      c.contract_number,
      a.inventory_number,
      a.name equipment_name,
      a.brand,
      a.model,
      a.serial_number,
      i.composition_amendment_asset_id,
      caa.amendment_id composition_amendment_id,
      caa.change_action composition_change_action,
      cam.amendment_number composition_amendment_number,
      i.document_id,
      d.document_number,
      i.completed_at,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id',f.id,
            'file_kind',f.file_kind,
            'file_name',f.file_name,
            'mime_type',f.mime_type,
            'file_size',f.file_size,
            'storage_path',f.storage_path,
            'caption',f.caption
          )
          order by f.created_at
        )
        from public.equipment_condition_inspection_files f
        where f.inspection_id=i.id
      ),'[]'::jsonb) files
    from public.equipment_condition_inspections i
    join public.equipment_contracts c on c.id=i.contract_id
    join public.equipment_assets a on a.id=i.equipment_id
    left join public.equipment_contract_amendment_assets caa
      on caa.id=i.composition_amendment_asset_id
    left join public.equipment_contract_amendments cam
      on cam.id=caa.amendment_id
    left join public.documents d on d.id=i.document_id
    where i.partner_id=v_partner_id
      and i.status='COMPLETED'
  ) x;

  return v_result;
end
$function$;

revoke all on function public.get_my_equipment_condition_inspections()
from public,anon,authenticated;
grant execute on function public.get_my_equipment_condition_inspections()
to authenticated;

select private.assert_production_farm_security_baseline();
