# A4PRINT HUB — архитектура

## Назначение

Единая внутренняя система для двух направлений бизнеса: А4-Принт и 3D-ARTPRINT.

## Главные принципы

1. Один клиент — одна карточка и единая история.
2. Один товар — единая номенклатура и общий складской остаток.
3. Один заказ — единая карточка со статусом, задачами, файлами и сообщениями.
4. Направление бизнеса хранится в заказах, товарах и услугах как `business_unit`.
5. GitHub — только код и документация; клиентские данные и секреты — во внешней защищённой БД.

## Модули

- Dashboard
- Orders
- Customers
- Products
- Services
- Warehouses
- Production
- 3D Catalog
- Messages
- Notifications
- Reports
- Employees / Roles
- Settings

## Направления

```text
A4_PRINT
3D_ARTPRINT
COMMON
```

## Поток заказа 3D-ARTPRINT

```text
3d-artprint.ru
      ↓
   API
      ↓
  orders
      ├── customer
      ├── order_items
      ├── 3d_model + source_url
      ├── print parameters
      ├── production job
      └── messages
```

Email остаётся каналом уведомления, но не источником истины.

## Склад

Движения: `RECEIPT`, `ISSUE`, `TRANSFER`, `ADJUSTMENT`, `RETURN`.

Остатки должны изменяться транзакционно и иметь историю операций.

## Заказы

Базовые статусы:

`NEW → CONFIRMED → IN_PROGRESS → READY → COMPLETED`

Дополнительные: `ON_HOLD`, `CANCELLED`.

## Сообщения

Поддерживаются общий чат, личные чаты и сообщения, привязанные к заказу или производственной задаче.
