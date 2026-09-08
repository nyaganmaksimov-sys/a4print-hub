-- Customer finance linkage for A4PRINT HUB.
-- Keeps invoice, payment, customer, order and document state consistent.

alter table public.payments
  add column if not exists customer_document_id uuid
  references public.customer_documents(id) on delete set null;

create index if not exists payments_customer_document_id_idx
  on public.payments(customer_document_id);

create sequence if not exists public.hub_payment_number_seq;

alter table public.payments alter column currency set default 'RUB';
alter table public.payments alter column payment_type set default 'INCOME';
alter table public.payments alter column payment_number set default (
  'PAY-' || to_char(current_date,'YYYYMMDD') || '-' ||
  lpad(nextval('public.hub_payment_number_seq')::text,5,'0')
);

create or replace function public.recalculate_customer_document_payment_status(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_amount numeric := 0;
  v_paid numeric := 0;
  v_status text;
begin
  if p_document_id is null then return; end if;

  select coalesce(amount,0),status
    into v_amount,v_status
  from public.customer_documents
  where id=p_document_id;
  if not found then return; end if;

  select coalesce(sum(amount),0)
    into v_paid
  from public.payments
  where customer_document_id=p_document_id
    and upper(coalesce(status,'')) in ('PAID','COMPLETED','SUCCESS','SUCCESSFUL','CONFIRMED','CAPTURED');

  if v_paid>=v_amount and v_amount>0
     and upper(coalesce(v_status,'')) not in ('CANCELLED','ARCHIVED') then
    update public.customer_documents
       set status='PAID',updated_at=now()
     where id=p_document_id and status is distinct from 'PAID';
  elsif upper(coalesce(v_status,''))='PAID' and v_paid<v_amount then
    update public.customer_documents
       set status='ISSUED',updated_at=now()
     where id=p_document_id;
  end if;
end;
$$;

create or replace function public.sync_customer_document_payment_status()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    perform public.recalculate_customer_document_payment_status(old.customer_document_id);
  end if;
  if tg_op in ('INSERT','UPDATE') then
    perform public.recalculate_customer_document_payment_status(new.customer_document_id);
  end if;
  return coalesce(new,old);
end;
$$;

drop trigger if exists trg_sync_customer_document_payment_status on public.payments;
create trigger trg_sync_customer_document_payment_status
after insert or update of amount,status,customer_document_id or delete
on public.payments
for each row execute function public.sync_customer_document_payment_status();

-- The generic documents table previously had RLS enabled without policies.
drop policy if exists documents_hub_staff_read on public.documents;
create policy documents_hub_staff_read
on public.documents for select
using (public.is_hub_staff());

drop policy if exists documents_admin_manager_write on public.documents;
create policy documents_admin_manager_write
on public.documents for all
using (public.has_role('ADMIN') or public.has_role('MANAGER'))
with check (public.has_role('ADMIN') or public.has_role('MANAGER'));

-- Creating a customer invoice is an issuance action, not merely a draft.
create or replace function public.create_customer_invoice(
  p_customer_id uuid,
  p_amount numeric,
  p_description text default null,
  p_due_date date default null,
  p_order_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_customer public.customers%rowtype;
  v_document_id uuid;
  v_document_number text;
  v_user_id uuid;
begin
  if not (public.has_role('ADMIN') or public.has_role('MANAGER')) then
    raise exception 'MANAGER_REQUIRED';
  end if;
  if p_amount is null or p_amount<=0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  select * into v_customer from public.customers where id=p_customer_id;
  if v_customer.id is null then raise exception 'CUSTOMER_NOT_FOUND'; end if;

  select u.id into v_user_id
  from public.users u
  where u.auth_user_id=auth.uid()
  limit 1;

  v_document_number := 'СЧ-' || extract(year from current_date)::text || '-' ||
                       lpad(nextval('public.customer_invoice_number_seq')::text,6,'0');

  insert into public.customer_documents(
    customer_id,order_id,document_type,document_number,status,title,amount,currency,
    issue_date,due_date,description,customer_snapshot,created_by
  ) values (
    v_customer.id,p_order_id,'INVOICE',v_document_number,'ISSUED',
    'Счёт на оплату '||v_document_number,p_amount,'RUB',current_date,p_due_date,p_description,
    jsonb_build_object(
      'customer_type',v_customer.customer_type,
      'full_name',v_customer.full_name,
      'company_name',v_customer.company_name,
      'legal_name',v_customer.legal_name,
      'phone',v_customer.phone,
      'email',v_customer.email,
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
      'signatory_basis',v_customer.signatory_basis
    ),v_user_id
  ) returning id into v_document_id;

  return v_document_id;
end;
$$;
