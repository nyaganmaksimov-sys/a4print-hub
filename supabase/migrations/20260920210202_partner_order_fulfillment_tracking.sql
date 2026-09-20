alter table public.orders
  add column if not exists partner_workflow text not null default 'NONE',
  add column if not exists partner_fulfillment_status text not null default 'NOT_SENT',
  add column if not exists partner_planned_cost numeric(14,2) not null default 0,
  add column if not exists partner_actual_cost numeric(14,2),
  add column if not exists partner_external_ref text,
  add column if not exists partner_tracking text,
  add column if not exists partner_fulfillment_updated_at timestamptz,
  add column if not exists partner_sent_at timestamptz,
  add column if not exists partner_confirmed_at timestamptz,
  add column if not exists partner_production_at timestamptz,
  add column if not exists partner_shipped_at timestamptz,
  add column if not exists partner_received_at timestamptz;

alter table public.orders drop constraint if exists orders_partner_workflow_check;
alter table public.orders add constraint orders_partner_workflow_check
  check (partner_workflow in ('NONE','MEMORIAL','SOUVENIR','TYPOGRAPHY'));

alter table public.orders drop constraint if exists orders_partner_fulfillment_status_check;
alter table public.orders add constraint orders_partner_fulfillment_status_check
  check (partner_fulfillment_status in ('NOT_SENT','SENT','CONFIRMED','IN_PRODUCTION','SHIPPED','RECEIVED','CANCELLED'));

alter table public.orders drop constraint if exists orders_partner_planned_cost_check;
alter table public.orders add constraint orders_partner_planned_cost_check check (partner_planned_cost >= 0);

alter table public.orders drop constraint if exists orders_partner_actual_cost_check;
alter table public.orders add constraint orders_partner_actual_cost_check check (partner_actual_cost is null or partner_actual_cost >= 0);

create index if not exists orders_partner_fulfillment_status_idx
  on public.orders(partner_fulfillment_status, updated_at desc)
  where fulfillment_partner_id is not null;

insert into public.partners(name,notes,is_active)
select 'Сфера','Поставщик: фотокерамика, сувенирная продукция и знаки · https://sferazakaz.ru/',true
where not exists (select 1 from public.partners where lower(name)=lower('Сфера'));

insert into public.partners(name,notes,is_active)
select 'Группа М','Типография · https://gmprint.ru/',true
where not exists (select 1 from public.partners where lower(name)=lower('Группа М'));

create or replace function public.create_hub_partner_order(
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_business_unit text,
  p_item_name text,
  p_quantity numeric,
  p_unit_price numeric,
  p_comment text,
  p_source text,
  p_partner_name text,
  p_partner_workflow text,
  p_partner_unit_cost numeric default 0
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_result jsonb;
  v_order_id uuid;
  v_partner_id uuid;
  v_workflow text := upper(btrim(coalesce(p_partner_workflow,'')));
  v_qty numeric := coalesce(p_quantity,1);
  v_unit_cost numeric := coalesce(p_partner_unit_cost,0);
  v_planned_cost numeric;
begin
  if not (public.has_role('ADMIN') or public.has_role('MANAGER')) then raise exception 'ACCESS_DENIED'; end if;
  if v_workflow not in ('MEMORIAL','SOUVENIR','TYPOGRAPHY') then raise exception 'INVALID_PARTNER_WORKFLOW'; end if;
  if v_unit_cost < 0 then raise exception 'PARTNER_COST_CANNOT_BE_NEGATIVE'; end if;

  select id into v_partner_id
  from public.partners
  where is_active=true and lower(name)=lower(btrim(coalesce(p_partner_name,'')))
  order by created_at limit 1;
  if v_partner_id is null then raise exception 'PARTNER_NOT_FOUND'; end if;

  v_result := public.create_hub_manual_order(
    p_customer_id,p_customer_name,p_customer_phone,p_business_unit,p_item_name,
    p_quantity,p_unit_price,p_comment,p_source
  );
  v_order_id := nullif(v_result->>'id','')::uuid;
  if v_order_id is null then raise exception 'ORDER_CREATE_FAILED'; end if;

  v_planned_cost := round(greatest(v_qty,0) * greatest(v_unit_cost,0),2);

  update public.orders
  set fulfillment_partner_id=v_partner_id,
      partner_direction='OUTBOUND',
      partner_workflow=v_workflow,
      partner_fulfillment_status='NOT_SENT',
      partner_planned_cost=v_planned_cost,
      partner_actual_cost=null,
      partner_fulfillment_updated_at=now(),
      updated_at=now()
  where id=v_order_id;

  return v_result || jsonb_build_object(
    'fulfillment_partner_id',v_partner_id,
    'partner_workflow',v_workflow,
    'partner_fulfillment_status','NOT_SENT',
    'partner_planned_cost',v_planned_cost
  );
end;
$function$;

revoke all on function public.create_hub_partner_order(uuid,text,text,text,text,numeric,numeric,text,text,text,text,numeric) from public;
revoke all on function public.create_hub_partner_order(uuid,text,text,text,text,numeric,numeric,text,text,text,text,numeric) from anon;
grant execute on function public.create_hub_partner_order(uuid,text,text,text,text,numeric,numeric,text,text,text,text,numeric) to authenticated;

create or replace function public.save_partner_order_fulfillment(
  p_order_id uuid,
  p_status text,
  p_actual_cost numeric default null,
  p_external_ref text default null,
  p_tracking text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_status text := upper(btrim(coalesce(p_status,'')));
  v_row public.orders%rowtype;
begin
  if not (public.has_role('ADMIN') or public.has_role('MANAGER')) then raise exception 'ACCESS_DENIED'; end if;
  if v_status not in ('NOT_SENT','SENT','CONFIRMED','IN_PRODUCTION','SHIPPED','RECEIVED','CANCELLED') then raise exception 'INVALID_PARTNER_STATUS'; end if;
  if p_actual_cost is not null and p_actual_cost < 0 then raise exception 'PARTNER_COST_CANNOT_BE_NEGATIVE'; end if;

  update public.orders
  set partner_fulfillment_status=v_status,
      partner_actual_cost=p_actual_cost,
      partner_external_ref=nullif(btrim(coalesce(p_external_ref,'')),''),
      partner_tracking=nullif(btrim(coalesce(p_tracking,'')),''),
      partner_fulfillment_updated_at=now(),
      partner_sent_at=case when v_status='SENT' then coalesce(partner_sent_at,now()) else partner_sent_at end,
      partner_confirmed_at=case when v_status='CONFIRMED' then coalesce(partner_confirmed_at,now()) else partner_confirmed_at end,
      partner_production_at=case when v_status='IN_PRODUCTION' then coalesce(partner_production_at,now()) else partner_production_at end,
      partner_shipped_at=case when v_status='SHIPPED' then coalesce(partner_shipped_at,now()) else partner_shipped_at end,
      partner_received_at=case when v_status='RECEIVED' then coalesce(partner_received_at,now()) else partner_received_at end,
      updated_at=now()
  where id=p_order_id and fulfillment_partner_id is not null and partner_direction='OUTBOUND'
  returning * into v_row;

  if v_row.id is null then raise exception 'PARTNER_ORDER_NOT_FOUND'; end if;

  return jsonb_build_object(
    'id',v_row.id,
    'partner_fulfillment_status',v_row.partner_fulfillment_status,
    'partner_planned_cost',v_row.partner_planned_cost,
    'partner_actual_cost',v_row.partner_actual_cost,
    'partner_external_ref',v_row.partner_external_ref,
    'partner_tracking',v_row.partner_tracking,
    'partner_fulfillment_updated_at',v_row.partner_fulfillment_updated_at
  );
end;
$function$;

revoke all on function public.save_partner_order_fulfillment(uuid,text,numeric,text,text) from public;
revoke all on function public.save_partner_order_fulfillment(uuid,text,numeric,text,text) from anon;
grant execute on function public.save_partner_order_fulfillment(uuid,text,numeric,text,text) to authenticated;
