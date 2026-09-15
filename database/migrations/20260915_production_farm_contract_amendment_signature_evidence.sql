-- A4PRINT HUB: Production Farm Phase 22 — contract amendment signature evidence.
-- Records immutable evidence for portal acceptance, paper signatures and external e-signatures.

create table if not exists public.equipment_contract_amendment_signatures (
  id uuid primary key default gen_random_uuid(),
  amendment_id uuid not null references public.equipment_contract_amendments(id) on delete restrict,
  contract_id uuid not null references public.equipment_contracts(id) on delete restrict,
  partner_id uuid not null references public.partners(id) on delete restrict,
  document_id uuid not null references public.documents(id) on delete restrict,
  signature_method text not null check(signature_method in ('PORTAL_ACCEPTANCE','PAPER','EXTERNAL_ESIGN')),
  partner_response_id uuid references public.equipment_partner_responses(id) on delete restrict,
  reference text,
  notes text,
  evidence jsonb not null default '{}'::jsonb,
  recorded_by uuid not null references public.users(id) on delete restrict,
  recorded_at timestamptz not null default clock_timestamp(),
  unique(amendment_id)
);

create index if not exists equipment_contract_amendment_signatures_contract_idx
  on public.equipment_contract_amendment_signatures(contract_id,recorded_at desc);
create index if not exists equipment_contract_amendment_signatures_partner_idx
  on public.equipment_contract_amendment_signatures(partner_id,recorded_at desc);
create index if not exists equipment_contract_amendment_signatures_document_idx
  on public.equipment_contract_amendment_signatures(document_id);
create index if not exists equipment_contract_amendment_signatures_response_idx
  on public.equipment_contract_amendment_signatures(partner_response_id) where partner_response_id is not null;
create index if not exists equipment_contract_amendment_signatures_recorded_by_idx
  on public.equipment_contract_amendment_signatures(recorded_by);

alter table public.equipment_contract_amendment_signatures enable row level security;
drop policy if exists equipment_contract_amendment_signatures_read on public.equipment_contract_amendment_signatures;
create policy equipment_contract_amendment_signatures_read
on public.equipment_contract_amendment_signatures
for select to authenticated
using(
  public.has_permission('equipment.view')
  or public.has_permission('equipment.contracts.manage')
  or partner_id=public.current_partner_id()
);

revoke all on public.equipment_contract_amendment_signatures from public,anon,authenticated;
grant select on public.equipment_contract_amendment_signatures to authenticated;

drop trigger if exists trg_audit_equipment_contract_amendment_signatures on public.equipment_contract_amendment_signatures;
create trigger trg_audit_equipment_contract_amendment_signatures
after insert or update or delete on public.equipment_contract_amendment_signatures
for each row execute function public.audit_row_change();

create or replace function public.guard_equipment_contract_amendment_signature_immutable()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  raise exception 'SIGNATURE_EVIDENCE_IMMUTABLE';
end
$$;
revoke all on function public.guard_equipment_contract_amendment_signature_immutable() from public,anon,authenticated;

drop trigger if exists trg_guard_equipment_contract_amendment_signature_immutable on public.equipment_contract_amendment_signatures;
create trigger trg_guard_equipment_contract_amendment_signature_immutable
before update or delete on public.equipment_contract_amendment_signatures
for each row execute function public.guard_equipment_contract_amendment_signature_immutable();

create or replace function public.submit_equipment_partner_response(p_entity_type text, p_entity_id uuid, p_response_status text, p_comment text default null)
returns uuid
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
       and dt.code in ('EQ_ACCEPTANCE_ACT','EQ_ASSET_LIST','EQ_TERMS_APPENDIX','EQ_RETURN_ACT','EQ_RECONCILIATION_ACT','EQ_CONTRACT_AMENDMENT')
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
revoke all on function public.submit_equipment_partner_response(text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.submit_equipment_partner_response(text,uuid,text,text) to authenticated;

create or replace function public.record_equipment_contract_amendment_signature(
  p_amendment_id uuid,
  p_signature_method text,
  p_reference text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_a public.equipment_contract_amendments%rowtype;
  v_method text:=upper(btrim(coalesce(p_signature_method,'')));
  v_reference text:=nullif(btrim(coalesce(p_reference,'')),'');
  v_actor uuid;
  v_old public.document_status;
  v_doc_number text;
  v_response public.equipment_partner_responses%rowtype;
  v_id uuid;
  v_existing uuid;
  v_evidence jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_permission('equipment.contracts.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if p_amendment_id is null then raise exception 'AMENDMENT_REQUIRED'; end if;
  if v_method not in ('PORTAL_ACCEPTANCE','PAPER','EXTERNAL_ESIGN') then raise exception 'INVALID_SIGNATURE_METHOD'; end if;

  select * into v_a from public.equipment_contract_amendments where id=p_amendment_id for update;
  if v_a.id is null then raise exception 'AMENDMENT_NOT_FOUND'; end if;
  if v_a.status<>'APPROVED' then raise exception 'AMENDMENT_MUST_BE_APPROVED'; end if;

  select status,document_number into v_old,v_doc_number from public.documents where id=v_a.document_id for update;
  if v_old not in ('APPROVED'::public.document_status,'SIGNED'::public.document_status) then raise exception 'DOCUMENT_NOT_READY_FOR_SIGNATURE'; end if;

  select id into v_existing from public.equipment_contract_amendment_signatures where amendment_id=v_a.id;
  if v_existing is not null then return v_existing; end if;

  if v_method='PORTAL_ACCEPTANCE' then
    select * into v_response
      from public.equipment_partner_responses
     where partner_id=v_a.partner_id
       and entity_type='CONTRACT_DOCUMENT'
       and entity_id=v_a.document_id
     order by event_sequence desc
     limit 1;
    if v_response.id is null or v_response.response_status<>'ACKNOWLEDGED' then raise exception 'PARTNER_ACCEPTANCE_REQUIRED'; end if;
    v_reference:='PORTAL_RESPONSE:'||v_response.id::text;
  elsif v_reference is null then
    raise exception 'SIGNATURE_REFERENCE_REQUIRED';
  end if;

  v_actor:=public.current_staff_user_id();
  if v_actor is null then raise exception 'STAFF_USER_NOT_FOUND'; end if;

  v_evidence:=jsonb_strip_nulls(jsonb_build_object(
    'schema_version',1,
    'amendment_id',v_a.id,
    'amendment_number',v_a.amendment_number,
    'contract_id',v_a.contract_id,
    'partner_id',v_a.partner_id,
    'document_id',v_a.document_id,
    'document_number',v_doc_number,
    'signature_method',v_method,
    'reference',v_reference,
    'partner_response_id',v_response.id,
    'partner_user_id',v_response.partner_user_id,
    'partner_response_sequence',v_response.event_sequence,
    'partner_response_created_at',v_response.created_at,
    'recorded_by',v_actor,
    'recorded_at',clock_timestamp()
  ));

  insert into public.equipment_contract_amendment_signatures(
    amendment_id,contract_id,partner_id,document_id,signature_method,partner_response_id,reference,notes,evidence,recorded_by
  ) values(
    v_a.id,v_a.contract_id,v_a.partner_id,v_a.document_id,v_method,v_response.id,v_reference,
    nullif(btrim(coalesce(p_notes,'')),''),v_evidence,v_actor
  ) returning id into v_id;

  if v_old='APPROVED'::public.document_status then
    update public.documents
       set status='SIGNED'::public.document_status,
           signed_at=coalesce(signed_at,clock_timestamp()),
           updated_at=clock_timestamp()
     where id=v_a.document_id;
    insert into public.document_status_history(document_id,old_status,new_status,changed_by,comment)
    values(
      v_a.document_id,v_old,'SIGNED'::public.document_status,v_actor,
      'Подпись ДС подтверждена: '||v_method||case when v_reference is not null then ' · '||v_reference else '' end
    );
  end if;

  return v_id;
end
$$;
revoke all on function public.record_equipment_contract_amendment_signature(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.record_equipment_contract_amendment_signature(uuid,text,text,text) to authenticated;

-- Compatibility wrapper: old clients can no longer sign by staff confirmation alone.
-- The wrapper now requires a current portal acceptance from the owner.
create or replace function public.mark_equipment_contract_amendment_signed(p_amendment_id uuid, p_comment text default null)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_signature_id uuid;
begin
  v_signature_id:=public.record_equipment_contract_amendment_signature(
    p_amendment_id,
    'PORTAL_ACCEPTANCE',
    null,
    p_comment
  );
  return p_amendment_id;
end
$$;
revoke all on function public.mark_equipment_contract_amendment_signed(uuid,text) from public,anon,authenticated;
grant execute on function public.mark_equipment_contract_amendment_signed(uuid,text) to authenticated;
