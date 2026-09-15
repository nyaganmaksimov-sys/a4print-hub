-- A4PRINT HUB: Production Farm Phase 26 — controlled claims after resolved condition comparisons.

insert into public.document_types(name,code,description,requires_signature,default_validity_days)
select 'Требование по состоянию оборудования','EQ_CONDITION_CLAIM','Формализованное требование после рассмотренной сверки состояния оборудования; не является автоматической финансовой проводкой',false,null
where not exists(select 1 from public.document_types where code='EQ_CONDITION_CLAIM');

create table if not exists public.equipment_condition_claims (
  id uuid primary key default gen_random_uuid(),
  comparison_id uuid not null unique references public.equipment_condition_comparisons(id) on delete restrict,
  contract_id uuid not null references public.equipment_contracts(id) on delete restrict,
  equipment_id uuid not null references public.equipment_assets(id) on delete restrict,
  partner_id uuid not null references public.partners(id) on delete restrict,
  termination_id uuid references public.equipment_contract_terminations(id) on delete restrict,
  claim_direction text not null check(claim_direction in ('HUB_TO_OWNER','OWNER_TO_HUB','MUTUAL')),
  status text not null default 'DRAFT' check(status in ('DRAFT','ISSUED','ACKNOWLEDGED','DISPUTED','SETTLED','WAIVED','CANCELLED')),
  requested_amount numeric not null check(requested_amount>0),
  currency text not null default 'RUB',
  due_date date,
  basis text not null,
  evidence jsonb not null default '[]'::jsonb,
  document_id uuid unique references public.documents(id) on delete restrict,
  issued_by uuid references public.users(id) on delete restrict,
  issued_at timestamptz,
  resolved_by uuid references public.users(id) on delete restrict,
  resolved_at timestamptz,
  resolution_note text,
  settled_amount numeric check(settled_amount is null or settled_amount>=0),
  settlement_reference text,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index if not exists equipment_condition_claims_partner_idx on public.equipment_condition_claims(partner_id,status,created_at desc);
create index if not exists equipment_condition_claims_contract_idx on public.equipment_condition_claims(contract_id,status,created_at desc);
create index if not exists equipment_condition_claims_equipment_idx on public.equipment_condition_claims(equipment_id,created_at desc);
create index if not exists equipment_condition_claims_termination_idx on public.equipment_condition_claims(termination_id) where termination_id is not null;

create table if not exists public.equipment_condition_claim_responses (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.equipment_condition_claims(id) on delete restrict,
  partner_id uuid not null references public.partners(id) on delete restrict,
  partner_user_id uuid references public.partner_users(id) on delete set null,
  response_status text not null check(response_status in ('ACKNOWLEDGED','DISPUTED')),
  comment text,
  event_sequence bigint generated always as identity,
  created_at timestamptz not null default clock_timestamp(),
  check(response_status<>'DISPUTED' or nullif(btrim(coalesce(comment,'')),'') is not null)
);
create index if not exists equipment_condition_claim_responses_claim_idx on public.equipment_condition_claim_responses(claim_id,event_sequence desc);
create index if not exists equipment_condition_claim_responses_partner_idx on public.equipment_condition_claim_responses(partner_id,event_sequence desc);

alter table public.equipment_condition_claims enable row level security;
alter table public.equipment_condition_claim_responses enable row level security;

drop policy if exists equipment_condition_claims_read on public.equipment_condition_claims;
create policy equipment_condition_claims_read on public.equipment_condition_claims for select to authenticated
using(
  public.has_permission('equipment.view')
  or public.has_permission('equipment.manage')
  or public.has_permission('equipment.contracts.manage')
  or (status<>'DRAFT' and partner_id=public.current_partner_id())
);

drop policy if exists equipment_condition_claim_responses_read on public.equipment_condition_claim_responses;
create policy equipment_condition_claim_responses_read on public.equipment_condition_claim_responses for select to authenticated
using(
  public.has_permission('equipment.view')
  or public.has_permission('equipment.manage')
  or public.has_permission('equipment.contracts.manage')
  or partner_id=public.current_partner_id()
);

revoke all on public.equipment_condition_claims from public,anon,authenticated;
revoke all on public.equipment_condition_claim_responses from public,anon,authenticated;
grant select on public.equipment_condition_claims to authenticated;
grant select on public.equipment_condition_claim_responses to authenticated;

drop trigger if exists trg_equipment_condition_claims_updated_at on public.equipment_condition_claims;
create trigger trg_equipment_condition_claims_updated_at before update on public.equipment_condition_claims for each row execute function public.touch_production_farm_updated_at();
drop trigger if exists trg_audit_equipment_condition_claims on public.equipment_condition_claims;
create trigger trg_audit_equipment_condition_claims after insert or update or delete on public.equipment_condition_claims for each row execute function public.audit_row_change();
drop trigger if exists trg_audit_equipment_condition_claim_responses on public.equipment_condition_claim_responses;
create trigger trg_audit_equipment_condition_claim_responses after insert or update or delete on public.equipment_condition_claim_responses for each row execute function public.audit_row_change();

create or replace function public.guard_equipment_condition_claim_core()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='DELETE' then raise exception 'CONDITION_CLAIM_IMMUTABLE'; end if;
  if old.status<>'DRAFT' and row(new.comparison_id,new.contract_id,new.equipment_id,new.partner_id,new.termination_id,new.claim_direction,new.requested_amount,new.currency,new.due_date,new.basis,new.evidence,new.document_id,new.created_by,new.created_at)
     is distinct from row(old.comparison_id,old.contract_id,old.equipment_id,old.partner_id,old.termination_id,old.claim_direction,old.requested_amount,old.currency,old.due_date,old.basis,old.evidence,old.document_id,old.created_by,old.created_at)
  then raise exception 'ISSUED_CONDITION_CLAIM_CORE_IMMUTABLE'; end if;
  if old.status in ('SETTLED','WAIVED','CANCELLED') and new is distinct from old then raise exception 'CLOSED_CONDITION_CLAIM_IMMUTABLE'; end if;
  return new;
end
$$;
revoke all on function public.guard_equipment_condition_claim_core() from public,anon,authenticated;
drop trigger if exists trg_guard_equipment_condition_claim_core on public.equipment_condition_claims;
create trigger trg_guard_equipment_condition_claim_core before update or delete on public.equipment_condition_claims for each row execute function public.guard_equipment_condition_claim_core();

create or replace function public.guard_equipment_condition_claim_response_append_only()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  raise exception 'CONDITION_CLAIM_RESPONSE_APPEND_ONLY';
end
$$;
revoke all on function public.guard_equipment_condition_claim_response_append_only() from public,anon,authenticated;
drop trigger if exists trg_guard_equipment_condition_claim_response_append_only on public.equipment_condition_claim_responses;
create trigger trg_guard_equipment_condition_claim_response_append_only before update or delete on public.equipment_condition_claim_responses for each row execute function public.guard_equipment_condition_claim_response_append_only();

create or replace function public.save_equipment_condition_claim(
  p_claim_id uuid,
  p_comparison_id uuid,
  p_requested_amount numeric,
  p_basis text,
  p_due_date date default null,
  p_claim_direction text default null,
  p_evidence jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_c public.equipment_condition_comparisons%rowtype;
  v_contract public.equipment_contracts%rowtype;
  v_direction text:=upper(btrim(coalesce(p_claim_direction,'')));
  v_expected text;
  v_actor uuid;
  v_id uuid;
  v_status text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not (public.has_permission('equipment.contracts.manage') or public.has_permission('equipment.manage')) then raise exception 'PERMISSION_DENIED'; end if;
  if p_comparison_id is null then raise exception 'COMPARISON_REQUIRED'; end if;
  if p_requested_amount is null or p_requested_amount<=0 then raise exception 'CLAIM_AMOUNT_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_basis,'')),'') is null then raise exception 'CLAIM_BASIS_REQUIRED'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence)<>'array' then raise exception 'INVALID_CLAIM_EVIDENCE'; end if;

  select * into v_c from public.equipment_condition_comparisons where id=p_comparison_id;
  if v_c.id is null then raise exception 'COMPARISON_NOT_FOUND'; end if;
  if v_c.comparison_status<>'RESOLVED' then raise exception 'COMPARISON_MUST_BE_RESOLVED'; end if;
  if v_c.resolution_code in ('NO_CLAIM','NORMAL_WEAR') then raise exception 'CLAIM_NOT_ALLOWED_FOR_RESOLUTION'; end if;
  if v_c.resolution_code is null then raise exception 'COMPARISON_RESOLUTION_REQUIRED'; end if;

  v_expected:=case v_c.resolution_code
    when 'OWNER_RESPONSIBILITY' then 'HUB_TO_OWNER'
    when 'HUB_RESPONSIBILITY' then 'OWNER_TO_HUB'
    when 'SHARED' then 'MUTUAL'
    else null
  end;
  if v_expected is not null then
    if v_direction='' then v_direction:=v_expected; end if;
    if v_direction<>v_expected then raise exception 'CLAIM_DIRECTION_MISMATCH:%',v_expected; end if;
  else
    if v_direction not in ('HUB_TO_OWNER','OWNER_TO_HUB','MUTUAL') then raise exception 'CLAIM_DIRECTION_REQUIRED'; end if;
  end if;

  select * into v_contract from public.equipment_contracts where id=v_c.contract_id;
  if v_contract.id is null then raise exception 'CONTRACT_NOT_FOUND'; end if;
  v_actor:=public.current_staff_user_id(); if v_actor is null then raise exception 'STAFF_USER_NOT_FOUND'; end if;

  if p_claim_id is null then
    if exists(select 1 from public.equipment_condition_claims where comparison_id=v_c.id) then raise exception 'CLAIM_ALREADY_EXISTS'; end if;
    insert into public.equipment_condition_claims(
      comparison_id,contract_id,equipment_id,partner_id,termination_id,claim_direction,status,requested_amount,currency,due_date,basis,evidence,created_by
    ) values(
      v_c.id,v_c.contract_id,v_c.equipment_id,v_c.partner_id,v_c.termination_id,v_direction,'DRAFT',p_requested_amount,coalesce(nullif(btrim(v_contract.currency),''),'RUB'),p_due_date,btrim(p_basis),p_evidence,v_actor
    ) returning id into v_id;
  else
    select status into v_status from public.equipment_condition_claims where id=p_claim_id and comparison_id=v_c.id for update;
    if v_status is null then raise exception 'CLAIM_NOT_FOUND'; end if;
    if v_status<>'DRAFT' then raise exception 'CLAIM_NOT_EDITABLE'; end if;
    update public.equipment_condition_claims
       set claim_direction=v_direction,requested_amount=p_requested_amount,currency=coalesce(nullif(btrim(v_contract.currency),''),'RUB'),due_date=p_due_date,basis=btrim(p_basis),evidence=p_evidence
     where id=p_claim_id;
    v_id:=p_claim_id;
  end if;
  return v_id;
end
$$;
revoke all on function public.save_equipment_condition_claim(uuid,uuid,numeric,text,date,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_equipment_condition_claim(uuid,uuid,numeric,text,date,text,jsonb) to authenticated;

create or replace function public.issue_equipment_condition_claim(p_claim_id uuid)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_claim public.equipment_condition_claims%rowtype;
  v_cmp public.equipment_condition_comparisons%rowtype;
  v_actor uuid;
  v_doc_type uuid;
  v_doc uuid;
  v_number text;
  v_title text;
  v_snapshot jsonb;
  v_equipment jsonb;
  v_partner jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not (public.has_permission('equipment.contracts.manage') or public.has_permission('equipment.manage')) then raise exception 'PERMISSION_DENIED'; end if;
  select * into v_claim from public.equipment_condition_claims where id=p_claim_id for update;
  if v_claim.id is null then raise exception 'CLAIM_NOT_FOUND'; end if;
  if v_claim.status<>'DRAFT' then raise exception 'CLAIM_NOT_ISSUABLE'; end if;
  select * into v_cmp from public.equipment_condition_comparisons where id=v_claim.comparison_id;
  if v_cmp.comparison_status<>'RESOLVED' then raise exception 'COMPARISON_MUST_BE_RESOLVED'; end if;
  if v_cmp.resolution_code in ('NO_CLAIM','NORMAL_WEAR') then raise exception 'CLAIM_NOT_ALLOWED_FOR_RESOLUTION'; end if;
  v_actor:=public.current_staff_user_id(); if v_actor is null then raise exception 'STAFF_USER_NOT_FOUND'; end if;

  select jsonb_build_object('id',a.id,'inventory_number',a.inventory_number,'name',a.name,'brand',a.brand,'model',a.model,'serial_number',a.serial_number,'ownership_type',a.ownership_type) into v_equipment from public.equipment_assets a where a.id=v_claim.equipment_id;
  select jsonb_build_object('id',p.id,'name',p.name,'legal_name',p.legal_name,'tax_id',p.tax_id,'registration_number',p.registration_number,'address',p.address,'contact_name',p.contact_name,'email',p.email,'phone',p.phone) into v_partner from public.partners p where p.id=v_claim.partner_id;
  v_snapshot:=jsonb_build_object(
    'schema_version',1,'claim_id',v_claim.id,'comparison_id',v_claim.comparison_id,'claim_direction',v_claim.claim_direction,
    'requested_amount',v_claim.requested_amount,'currency',v_claim.currency,'due_date',v_claim.due_date,'basis',v_claim.basis,'evidence',v_claim.evidence,
    'comparison_resolution_code',v_cmp.resolution_code,'comparison_resolution_note',v_cmp.resolution_note,'comparison_delta',v_cmp.delta_snapshot,
    'contract',public.equipment_contract_legal_snapshot(v_claim.contract_id),'equipment',v_equipment,'partner',v_partner,'termination_id',v_claim.termination_id,
    'issued_by',v_actor,'issued_at',clock_timestamp(),'financial_posting_created',false
  );
  select id into v_doc_type from public.document_types where code='EQ_CONDITION_CLAIM';
  if v_doc_type is null then raise exception 'DOCUMENT_TYPE_NOT_FOUND'; end if;
  v_number:='CLM-'||to_char(current_date,'YYYYMMDD')||'-'||upper(substr(v_claim.id::text,1,8));
  v_title:='Требование по состоянию оборудования · '||coalesce(v_equipment->>'inventory_number',v_equipment->>'name','оборудование');
  insert into public.documents(document_type_id,document_number,title,status,business_unit,issue_date,created_by,notes,metadata,created_at,updated_at)
  values(v_doc_type,v_number,v_title,'ACTIVE'::public.document_status,'COMMON'::public.business_unit,current_date,v_actor,v_claim.basis,v_snapshot,clock_timestamp(),clock_timestamp())
  returning id into v_doc;

  insert into public.document_links(document_id,entity_type,entity_id,relationship,created_at) values(v_doc,'EQUIPMENT_CONDITION_CLAIM',v_claim.id,'SOURCE',clock_timestamp()) on conflict do nothing;
  insert into public.document_links(document_id,entity_type,entity_id,relationship,created_at) values(v_doc,'EQUIPMENT_CONDITION_COMPARISON',v_claim.comparison_id,'CLAIM',clock_timestamp()) on conflict do nothing;
  insert into public.document_links(document_id,entity_type,entity_id,relationship,created_at) values(v_doc,'EQUIPMENT_ASSET',v_claim.equipment_id,'CONDITION_CLAIM',clock_timestamp()) on conflict do nothing;
  insert into public.document_links(document_id,entity_type,entity_id,relationship,created_at) values(v_doc,'EQUIPMENT_CONTRACT',v_claim.contract_id,'CONDITION_CLAIM',clock_timestamp()) on conflict do nothing;
  insert into public.document_links(document_id,entity_type,entity_id,relationship,created_at) values(v_doc,'PARTNER',v_claim.partner_id,'CONDITION_CLAIM',clock_timestamp()) on conflict do nothing;
  if v_claim.termination_id is not null then insert into public.document_links(document_id,entity_type,entity_id,relationship,created_at) values(v_doc,'EQUIPMENT_CONTRACT_TERMINATION',v_claim.termination_id,'CONDITION_CLAIM',clock_timestamp()) on conflict do nothing; end if;

  update public.equipment_condition_claims set status='ISSUED',document_id=v_doc,issued_by=v_actor,issued_at=clock_timestamp() where id=v_claim.id;
  return v_claim.id;
end
$$;
revoke all on function public.issue_equipment_condition_claim(uuid) from public,anon,authenticated;
grant execute on function public.issue_equipment_condition_claim(uuid) to authenticated;

create or replace function public.submit_equipment_condition_claim_response(p_claim_id uuid,p_response_status text,p_comment text default null)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_partner uuid;
  v_partner_user uuid;
  v_claim public.equipment_condition_claims%rowtype;
  v_status text:=upper(btrim(coalesce(p_response_status,'')));
  v_latest text;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  v_partner:=public.current_partner_id(); if v_partner is null then raise exception 'PARTNER_ACCESS_REQUIRED'; end if;
  v_partner_user:=public.current_partner_user_id();
  if v_status not in ('ACKNOWLEDGED','DISPUTED') then raise exception 'INVALID_CLAIM_RESPONSE'; end if;
  if v_status='DISPUTED' and nullif(btrim(coalesce(p_comment,'')),'') is null then raise exception 'DISPUTE_COMMENT_REQUIRED'; end if;
  select * into v_claim from public.equipment_condition_claims where id=p_claim_id for update;
  if v_claim.id is null or v_claim.partner_id<>v_partner or v_claim.status='DRAFT' then raise exception 'CLAIM_NOT_AVAILABLE'; end if;
  if v_claim.status in ('SETTLED','WAIVED','CANCELLED') then raise exception 'CLAIM_FINAL'; end if;
  select r.response_status into v_latest from public.equipment_condition_claim_responses r where r.claim_id=v_claim.id order by r.event_sequence desc limit 1;
  if v_latest=v_status then raise exception 'CLAIM_RESPONSE_ALREADY_CURRENT'; end if;
  insert into public.equipment_condition_claim_responses(claim_id,partner_id,partner_user_id,response_status,comment)
  values(v_claim.id,v_partner,v_partner_user,v_status,nullif(btrim(coalesce(p_comment,'')),'')) returning id into v_id;
  update public.equipment_condition_claims set status=v_status where id=v_claim.id;
  if v_status='DISPUTED' then
    insert into public.notifications(user_id,title,body,type,entity_type,entity_id)
    select distinct u.id,'Владелец оспорил требование','Требование по состоянию оборудования требует рассмотрения','WARNING','EQUIPMENT_CONDITION_CLAIM',v_claim.id
      from public.users u
      join public.user_roles ur on ur.user_id=u.id
      join public.roles ro on ro.id=ur.role_id
      left join public.role_permissions rp on rp.role_id=ro.id
      left join public.permissions pp on pp.id=rp.permission_id
     where u.is_active=true and (ro.name='ADMIN' or pp.code in ('equipment.manage','equipment.contracts.manage'));
  end if;
  return v_id;
end
$$;
revoke all on function public.submit_equipment_condition_claim_response(uuid,text,text) from public,anon,authenticated;
grant execute on function public.submit_equipment_condition_claim_response(uuid,text,text) to authenticated;

create or replace function public.resolve_equipment_condition_claim(
  p_claim_id uuid,
  p_outcome text,
  p_resolution_note text,
  p_settled_amount numeric default null,
  p_settlement_reference text default null
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_claim public.equipment_condition_claims%rowtype;
  v_outcome text:=upper(btrim(coalesce(p_outcome,'')));
  v_actor uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not (public.has_permission('equipment.contracts.manage') or public.has_permission('equipment.manage')) then raise exception 'PERMISSION_DENIED'; end if;
  if v_outcome not in ('SETTLED','WAIVED','CANCELLED') then raise exception 'INVALID_CLAIM_OUTCOME'; end if;
  if nullif(btrim(coalesce(p_resolution_note,'')),'') is null then raise exception 'CLAIM_RESOLUTION_NOTE_REQUIRED'; end if;
  select * into v_claim from public.equipment_condition_claims where id=p_claim_id for update;
  if v_claim.id is null then raise exception 'CLAIM_NOT_FOUND'; end if;
  if v_claim.status in ('SETTLED','WAIVED','CANCELLED') then raise exception 'CLAIM_FINAL'; end if;
  if v_outcome='SETTLED' then
    if p_settled_amount is null or p_settled_amount<0 then raise exception 'SETTLED_AMOUNT_REQUIRED'; end if;
    if nullif(btrim(coalesce(p_settlement_reference,'')),'') is null then raise exception 'SETTLEMENT_REFERENCE_REQUIRED'; end if;
  end if;
  if v_claim.status='DRAFT' and v_outcome<>'CANCELLED' then raise exception 'DRAFT_CLAIM_CAN_ONLY_BE_CANCELLED'; end if;
  v_actor:=public.current_staff_user_id(); if v_actor is null then raise exception 'STAFF_USER_NOT_FOUND'; end if;
  update public.equipment_condition_claims
     set status=v_outcome,resolved_by=v_actor,resolved_at=clock_timestamp(),resolution_note=btrim(p_resolution_note),
         settled_amount=case when v_outcome='SETTLED' then p_settled_amount else null end,
         settlement_reference=case when v_outcome='SETTLED' then btrim(p_settlement_reference) else null end
   where id=v_claim.id;
  return v_claim.id;
end
$$;
revoke all on function public.resolve_equipment_condition_claim(uuid,text,text,numeric,text) from public,anon,authenticated;
grant execute on function public.resolve_equipment_condition_claim(uuid,text,text,numeric,text) to authenticated;

create or replace function public.list_equipment_condition_claims(p_include_closed boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_result jsonb;
begin
  if not (public.has_permission('equipment.view') or public.has_permission('equipment.manage') or public.has_permission('equipment.contracts.manage')) then raise exception 'PERMISSION_DENIED'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into v_result
  from (
    select cl.id claim_id,cl.status,cl.claim_direction,cl.requested_amount,cl.currency,cl.due_date,cl.basis,cl.evidence,
           cl.document_id,d.document_number,cl.issued_at,cl.resolved_at,cl.resolution_note,cl.settled_amount,cl.settlement_reference,cl.created_at,
           cl.comparison_id,c.resolution_code comparison_resolution_code,c.resolution_note comparison_resolution_note,c.delta_snapshot,
           cl.contract_id,ec.contract_number,cl.equipment_id,a.inventory_number,a.name equipment_name,a.brand,a.model,a.serial_number,
           cl.partner_id,coalesce(p.legal_name,p.name) partner_name,cl.termination_id,
           lr.response_status partner_response_status,lr.comment partner_response_comment,lr.created_at partner_responded_at
      from public.equipment_condition_claims cl
      join public.equipment_condition_comparisons c on c.id=cl.comparison_id
      join public.equipment_contracts ec on ec.id=cl.contract_id
      join public.equipment_assets a on a.id=cl.equipment_id
      join public.partners p on p.id=cl.partner_id
      left join public.documents d on d.id=cl.document_id
      left join lateral (
        select r.response_status,r.comment,r.created_at from public.equipment_condition_claim_responses r where r.claim_id=cl.id order by r.event_sequence desc limit 1
      ) lr on true
     where coalesce(p_include_closed,false) or cl.status not in ('SETTLED','WAIVED','CANCELLED')
  ) x;
  return v_result;
end
$$;
revoke all on function public.list_equipment_condition_claims(boolean) from public,anon,authenticated;
grant execute on function public.list_equipment_condition_claims(boolean) to authenticated;

create or replace function public.list_equipment_condition_claim_candidates()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_result jsonb;
begin
  if not (public.has_permission('equipment.manage') or public.has_permission('equipment.contracts.manage')) then raise exception 'PERMISSION_DENIED'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.resolved_at desc),'[]'::jsonb) into v_result
  from (
    select c.id comparison_id,c.resolution_code,c.resolution_note,c.resolved_at,c.delta_snapshot,c.contract_id,ec.contract_number,ec.currency,
           c.equipment_id,a.inventory_number,a.name equipment_name,a.brand,a.model,a.serial_number,c.partner_id,coalesce(p.legal_name,p.name) partner_name,c.termination_id,
           case c.resolution_code when 'OWNER_RESPONSIBILITY' then 'HUB_TO_OWNER' when 'HUB_RESPONSIBILITY' then 'OWNER_TO_HUB' when 'SHARED' then 'MUTUAL' else null end suggested_direction
      from public.equipment_condition_comparisons c
      join public.equipment_contracts ec on ec.id=c.contract_id
      join public.equipment_assets a on a.id=c.equipment_id
      join public.partners p on p.id=c.partner_id
     where c.comparison_status='RESOLVED'
       and c.resolution_code not in ('NO_CLAIM','NORMAL_WEAR')
       and not exists(select 1 from public.equipment_condition_claims cl where cl.comparison_id=c.id)
  ) x;
  return v_result;
end
$$;
revoke all on function public.list_equipment_condition_claim_candidates() from public,anon,authenticated;
grant execute on function public.list_equipment_condition_claim_candidates() to authenticated;

create or replace function public.get_my_equipment_condition_claims()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_partner uuid; v_result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  v_partner:=public.current_partner_id(); if v_partner is null then raise exception 'PARTNER_ACCESS_REQUIRED'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into v_result
  from (
    select cl.id claim_id,cl.status,cl.claim_direction,cl.requested_amount,cl.currency,cl.due_date,cl.basis,cl.evidence,
           cl.document_id,d.document_number,cl.issued_at,cl.resolved_at,cl.resolution_note,cl.settled_amount,cl.settlement_reference,cl.created_at,
           cl.comparison_id,c.resolution_code comparison_resolution_code,c.resolution_note comparison_resolution_note,
           ec.contract_number,a.inventory_number,a.name equipment_name,a.brand,a.model,a.serial_number,
           lr.response_status partner_response_status,lr.comment partner_response_comment,lr.created_at partner_responded_at
      from public.equipment_condition_claims cl
      join public.equipment_condition_comparisons c on c.id=cl.comparison_id
      join public.equipment_contracts ec on ec.id=cl.contract_id
      join public.equipment_assets a on a.id=cl.equipment_id
      left join public.documents d on d.id=cl.document_id
      left join lateral (
        select r.response_status,r.comment,r.created_at from public.equipment_condition_claim_responses r where r.claim_id=cl.id order by r.event_sequence desc limit 1
      ) lr on true
     where cl.partner_id=v_partner and cl.status<>'DRAFT'
  ) x;
  return v_result;
end
$$;
revoke all on function public.get_my_equipment_condition_claims() from public,anon,authenticated;
grant execute on function public.get_my_equipment_condition_claims() to authenticated;
