-- Financial category used when a POS retail return is recorded in HUB.
insert into public.cash_categories(organization_id,direction,name)
select o.id,'EXPENSE','Возврат клиенту'
from public.organizations o
where o.code='A4PRINT'
on conflict (organization_id,direction,name) do nothing;
