-- Fix missing SQL privileges for order status history.
-- RLS policies already restrict read/write by HUB roles; authenticated also needs table-level GRANTs.

grant select, insert on table public.order_status_history to authenticated;
