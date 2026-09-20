create or replace function public.create_hub_partner_manual_order(
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

revoke all on function public.create_hub_partner_manual_order(uuid,text,text,text,text,numeric,numeric,text,text,text,text,numeric) from public;
revoke all on function public.create_hub_partner_manual_order(uuid,text,text,text,text,numeric,numeric,text,text,text,text,numeric) from anon;
grant execute on function public.create_hub_partner_manual_order(uuid,text,text,text,text,numeric,numeric,text,text,text,text,numeric) to authenticated;

drop function if exists public.create_hub_partner_order(uuid,text,text,text,text,numeric,numeric,text,text,text,text,numeric);
