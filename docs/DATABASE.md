# A4PRINT HUB — модель базы данных

## Основная идея

A4-Принт и 3D-ARTPRINT используют одну БД. Разделение выполняется через `business_unit` там, где сущность относится к конкретному направлению.

## Основные группы

### Доступ
- `users`
- `roles`
- `user_roles`

### Клиенты
- `customers`

### Номенклатура
- `product_categories`
- `products`
- `services`

### Склад
- `warehouses`
- `warehouse_locations`
- `stock_balances`
- `stock_movements`
- `suppliers`
- `purchases`
- `purchase_items`

### 3D
- `models_3d`

### Заказы
- `orders`
- `order_items`
- `order_status_history`
- `order_files`

### Производство
- `production_jobs`
- `production_job_items`

### Коммуникации
- `chat_rooms`
- `chat_members`
- `messages`
- `notifications`

### Аудит
- `activity_log`
- `settings`

## Принцип склада

Остатки изменяются через движения: приход, расход, перемещение, корректировка и возврат. В будущем API будет выполнять эти операции транзакционно, чтобы нельзя было получить отрицательные или рассинхронизированные остатки из-за параллельных запросов.

## Заказы 3D-ARTPRINT

`orders.model_name` и `orders.model_url` сохраняются непосредственно в заказе. Это важно: даже если исходная модель позже исчезнет из каталога или изменит название, история заказа сохранит исходные данные.

Дополнительные параметры печати хранятся в `order_items.parameters` как JSONB.
