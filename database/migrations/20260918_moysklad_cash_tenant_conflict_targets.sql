-- PHASE 2 / MOYSKLAD MULTI-COMPANY
-- Add tenant-scoped conflict targets while legacy global keys remain for compatibility
-- during the rolling API deployment.

create unique index if not exists uq_pos_cash_balance_org_store
  on public.pos_cash_balance_state(organization_id, store_id)
  where organization_id is not null;

create unique index if not exists uq_pos_cash_operations_org_external
  on public.pos_cash_operations(organization_id, moysklad_operation_id)
  where organization_id is not null;
