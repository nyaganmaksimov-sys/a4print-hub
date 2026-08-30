-- A4PRINT HUB reference data
-- Safe to run repeatedly.

insert into product_categories (name, business_unit) values
  ('Бумага', 'A4_PRINT'),
  ('Расходные материалы для печати', 'A4_PRINT'),
  ('Пластик для 3D-печати', '3D_ARTPRINT'),
  ('Расходники 3D-печати', '3D_ARTPRINT'),
  ('Общие расходные материалы', 'COMMON')
on conflict (name) do nothing;

insert into services (name, business_unit, description, unit, base_price) values
  ('Печать документов', 'A4_PRINT', 'Чёрно-белая или цветная печать документов', 'лист', 0),
  ('Копирование', 'A4_PRINT', 'Копирование документов', 'лист', 0),
  ('Сканирование', 'A4_PRINT', 'Сканирование документов', 'лист', 0),
  ('3D-печать FDM', '3D_ARTPRINT', 'Изготовление модели методом FDM/FFF', 'заказ', 0),
  ('3D-печать Resin', '3D_ARTPRINT', 'Изготовление модели фотополимерной печатью', 'заказ', 0)
on conflict (name, business_unit) do nothing;

insert into warehouses (name, address, business_unit) values
  ('Основной склад', null, 'COMMON')
on conflict (name) do nothing;

insert into settings(key, value) values
  ('business_units', '{"items":["A4_PRINT","3D_ARTPRINT","COMMON"]}'),
  ('order_number_prefix', '{"A4_PRINT":"A4-","3D_ARTPRINT":"3D-"}')
on conflict (key) do nothing;
