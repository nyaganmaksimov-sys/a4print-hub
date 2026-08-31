-- A4PRINT HUB: customer invoice/document helpers
-- Run after 014_customer_billing_details.sql.

alter table public.document_types enable row level security;
alter table public.documents enable row level security;

drop policy if exists document_types_staff_read on public.document_types;
create policy document_types_staff_read on public.document_types for select to authenticated
using (public.is_hub_staff());

drop policy if exists documents_staff_read on public.documents;
create policy documents_staff_read on public.documents for select to authenticated
using (public.is_hub_staff());

create or replace function public.create_customer_invoice(
  p_customer_id uuid,
  p_amount numeric,
  p_description text,
  p_due_date date default null,
  p_order_id uuid default null
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_customer public.customers%rowtype;
  v_type_id uuid;
  v_doc_id uuid;
  v_number text;
  v_user_id uuid;
begin
  if not (public.has_role('ADMIN') or public.has_role('MANAGER')) then
    raise exception 'MANAGER_REQUIRED';
  end if;
  if coalesce(p_amount,0) <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  select * into v_customer from public.customers where id=p_customer_id;
  if v_customer.id is null then raise exception 'CUSTOMER_NOT_FOUND'; end if;

  select id into v_type_id from public.document_types where code='INVOICE' limit 1;
  if v_type_id is null then raise exception 'INVOICE_DOCUMENT_TYPE_NOT_FOUND'; end if;

  select id into v_user_id from public.users where auth_user_id=auth.uid() limit 1;
  v_number := 'СЧ-' || to_char(now(),'YYYYMMDD-HH24MISS') || '-' || upper(substr(gen_random_uuid()::text,1,4));

  insert into public.documents(
    document_number,document_type_id,title,status,business_unit,customer_id,order_id,
    created_by,responsible_user_id,issue_date,valid_until,notes,metadata
  ) values(
    v_number,v_type_id,'Счёт на оплату '||v_number,'DRAFT','COMMON',v_customer.id,p_order_id,
    v_user_id,v_user_id,current_date,p_due_date,p_description,
    jsonb_build_object(
      'amount',p_amount,
      'currency','RUB',
      'description',coalesce(p_description,''),
      'customer_snapshot',jsonb_build_object(
        'customer_type',v_customer.customer_type,
        'full_name',v_customer.full_name,
        'company_name',v_customer.company_name,
        'legal_name',v_customer.legal_name,
        'inn',v_customer.inn,
        'kpp',v_customer.kpp,
        'ogrn',v_customer.ogrn,
        'legal_address',v_customer.legal_address,
        'actual_address',v_customer.actual_address,
        'bank_name',v_customer.bank_name,
        'bik',v_customer.bik,
        'settlement_account',v_customer.settlement_account,
        'correspondent_account',v_customer.correspondent_account,
        'signatory_name',v_customer.signatory_name,
        'signatory_title',v_customer.signatory_title,
        'signatory_basis',v_customer.signatory_basis,
        'email',v_customer.email,
        'phone',v_customer.phone
      )
    )
  ) returning id into v_doc_id;

  return v_doc_id;
end;$$;

grant execute on function public.create_customer_invoice(uuid,numeric,text,date,uuid) to authenticated;
