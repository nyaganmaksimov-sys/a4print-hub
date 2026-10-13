-- Allow translation intake while retaining all existing partner workflow values.
ALTER TABLE public.orders
  DROP CONSTRAINT orders_partner_workflow_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_partner_workflow_check
  CHECK (partner_workflow IN ('NONE','MEMORIAL','SOUVENIR','TYPOGRAPHY','TRANSLATION'));
