create or replace function public.jarvis_semantic_search(p_query text, p_limit integer default 12)
returns table (
  entity_type text,
  entity_id uuid,
  title text,
  subtitle text,
  score real,
  route text,
  payload jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
with q as (
  select nullif(lower(trim(p_query)), '') as query
), candidates as (
  select 'customer'::text entity_type,c.id entity_id,coalesce(nullif(c.full_name,''),nullif(c.company_name,''),'Клиент')::text title,
    concat_ws(' · ',nullif(c.company_name,''),nullif(c.phone,''),nullif(c.email,''))::text subtitle,
    lower(concat_ws(' ',c.full_name,c.company_name,c.phone,c.email,c.inn,c.notes)) search_doc,
    ('./customer.html?id='||c.id::text)::text route,
    jsonb_build_object('customer_id',c.id,'full_name',c.full_name,'company_name',c.company_name,'phone',c.phone,'email',c.email,'inn',c.inn,'customer_type',c.customer_type) payload
  from public.customers c
  union all
  select 'order'::text,o.id,('Заказ №'||o.order_number::text)::text,
    concat_ws(' · ',coalesce(nullif(c.full_name,''),nullif(c.company_name,'')),o.status::text,trim(to_char(o.total,'FM999999990D00'))||' ₽')::text,
    lower(concat_ws(' ',o.order_number::text,o.status::text,o.total::text,o.customer_comment,o.internal_comment,o.model_name,c.full_name,c.company_name,c.phone,c.email,items.item_names)),
    ('./order.html?id='||o.id::text)::text,
    jsonb_build_object('order_id',o.id,'order_number',o.order_number,'status',o.status::text,'total',o.total,'due_at',o.due_at,'customer_id',o.customer_id,'customer_name',coalesce(nullif(c.full_name,''),nullif(c.company_name,'')),'items',items.items)
  from public.orders o left join public.customers c on c.id=o.customer_id
  left join lateral (select string_agg(oi.name,' ') item_names,coalesce(jsonb_agg(jsonb_build_object('name',oi.name,'quantity',oi.quantity,'total_price',oi.total_price) order by oi.name),'[]'::jsonb) items from public.order_items oi where oi.order_id=o.id) items on true
  union all
  select 'production'::text,p.id,coalesce(nullif(p.title,''),'Производственное задание')::text,
    concat_ws(' · ',case when o.order_number is not null then 'Заказ №'||o.order_number::text end,p.status::text,coalesce(nullif(c.full_name,''),nullif(c.company_name,'')))::text,
    lower(concat_ws(' ',p.title,p.status::text,p.notes,o.order_number::text,o.status::text,c.full_name,c.company_name)),
    ('./production.html?job='||p.id::text)::text,
    jsonb_build_object('production_job_id',p.id,'status',p.status::text,'title',p.title,'order_id',p.order_id,'order_number',o.order_number,'customer_id',o.customer_id,'customer_name',coalesce(nullif(c.full_name,''),nullif(c.company_name,'')),'planned_start',p.planned_start,'planned_end',p.planned_end,'priority',p.priority)
  from public.production_jobs p left join public.orders o on o.id=p.order_id left join public.customers c on c.id=o.customer_id
  union all
  select 'payment'::text,p.id,coalesce(nullif(p.payment_number,''),'Оплата')::text,
    concat_ws(' · ',coalesce(nullif(c.full_name,''),nullif(c.company_name,'')),trim(to_char(p.amount,'FM999999990D00'))||' ₽',p.status)::text,
    lower(concat_ws(' ',p.payment_number,p.status,p.payment_type,p.payment_method,p.amount::text,p.note,o.order_number::text,c.full_name,c.company_name,c.phone)),
    './payments.html'::text,
    jsonb_build_object('payment_id',p.id,'amount',p.amount,'status',p.status,'payment_type',p.payment_type,'payment_method',p.payment_method,'paid_at',p.paid_at,'order_id',p.order_id,'order_number',o.order_number,'customer_id',p.customer_id,'customer_name',coalesce(nullif(c.full_name,''),nullif(c.company_name,'')))
  from public.payments p left join public.customers c on c.id=p.customer_id left join public.orders o on o.id=p.order_id
  union all
  select 'employee'::text,u.id,coalesce(nullif(u.full_name,''),nullif(u.email,''),'Сотрудник')::text,
    concat_ws(' · ',nullif(u.position,''),nullif(u.phone,''),nullif(u.email,''))::text,
    lower(concat_ws(' ',u.full_name,u.position,u.phone,u.email)),'./employees.html'::text,
    jsonb_build_object('user_id',u.id,'full_name',u.full_name,'position',u.position,'phone',u.phone,'email',u.email,'avatar_url',u.avatar_url)
  from public.users u where u.is_active=true
  union all
  select 'equipment'::text,e.id,e.name::text,concat_ws(' · ',e.category,concat_ws(' ',e.brand,e.model),e.status,e.location)::text,
    lower(concat_ws(' ',e.inventory_number,e.name,e.category,e.brand,e.model,e.serial_number,e.location,e.status,e.notes)),
    ('./equipment.html?asset='||e.id::text)::text,
    jsonb_build_object('equipment_id',e.id,'inventory_number',e.inventory_number,'name',e.name,'category',e.category,'brand',e.brand,'model',e.model,'serial_number',e.serial_number,'location',e.location,'status',e.status,'last_service_date',e.last_service_date,'next_service_date',e.next_service_date,'responsible_user_id',e.responsible_user_id)
  from public.equipment_assets e
  union all
  select 'message'::text,m.id,coalesce(nullif(u.full_name,''),'Сообщение')::text,left(coalesce(m.body,''),160)::text,
    lower(concat_ws(' ',m.body,u.full_name,r.name,o.order_number::text)),'./messages.html'::text,
    jsonb_build_object('message_id',m.id,'room_id',m.room_id,'sender_id',m.sender_id,'sender_name',u.full_name,'room_name',r.name,'body',m.body,'created_at',m.created_at,'order_id',r.order_id,'order_number',o.order_number)
  from public.messages m left join public.users u on u.id=m.sender_id left join public.chat_rooms r on r.id=m.room_id left join public.orders o on o.id=r.order_id where m.deleted_at is null
)
select c.entity_type,c.entity_id,c.title,c.subtitle,
  greatest(similarity(c.search_doc,q.query),word_similarity(q.query,c.search_doc),case when c.search_doc like '%'||q.query||'%' then 1.0::real else 0.0::real end)::real score,
  c.route,c.payload
from candidates c cross join q
where q.query is not null and (c.search_doc like '%'||q.query||'%' or word_similarity(q.query,c.search_doc)>=0.16 or similarity(c.search_doc,q.query)>=0.12)
order by score desc,title
limit greatest(1,least(coalesce(p_limit,12),30));
$$;

revoke all on function public.jarvis_semantic_search(text,integer) from public;
grant execute on function public.jarvis_semantic_search(text,integer) to authenticated;
