create index if not exists order_items_order_id_idx
  on public.order_items (order_id);

create index if not exists chat_members_user_id_room_id_idx
  on public.chat_members (user_id, room_id);

create index if not exists orders_organization_created_at_idx
  on public.orders (organization_id, created_at desc);

create index if not exists production_jobs_organization_updated_at_idx
  on public.production_jobs (organization_id, updated_at desc);

create index if not exists pos_sales_organization_created_at_idx
  on public.pos_sales (organization_id, created_at desc);

create index if not exists pos_returns_organization_created_at_idx
  on public.pos_returns (organization_id, created_at desc);

create index if not exists catalog_items_organization_active_name_idx
  on public.catalog_items (organization_id, is_active, name);

create index if not exists jarvis_tasks_source_idx
  on public.jarvis_tasks (source);

create index if not exists jarvis_tasks_metadata_gin_idx
  on public.jarvis_tasks using gin (metadata jsonb_path_ops);
