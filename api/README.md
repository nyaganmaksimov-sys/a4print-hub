# A4PRINT HUB API

Первый контракт API. Реализация сервера будет добавлена следующим этапом.

## POST /orders

Создаёт заказ из сайта.

### Request

```json
{
  "business_unit": "3D_ARTPRINT",
  "customer": {
    "full_name": "Иван Иванов",
    "phone": "+31...",
    "email": "ivan@example.com"
  },
  "model": {
    "name": "Toyota Mark 2 JZX90",
    "source_url": "https://3dtoday.ru/..."
  },
  "items": [
    {
      "type": "SERVICE",
      "name": "3D-печать FDM",
      "quantity": 1,
      "unit_price": 1850,
      "parameters": {
        "material": "PLA",
        "color": "Black",
        "infill": 20,
        "dimensions": "100x80x40 mm"
      }
    }
  ],
  "total": 1850,
  "comment": "Комментарий клиента",
  "source": "3d-artprint.ru"
}
```

### Response

```json
{
  "success": true,
  "order": {
    "id": "uuid",
    "order_number": 127,
    "status": "NEW"
  }
}
```

## GET /orders

Список заказов с фильтрами:

- `business_unit`
- `status`
- `customer_id`
- `date_from`
- `date_to`
- `search`
- `page`
- `limit`

## GET /orders/:id

Полная карточка заказа: клиент, позиции, модель, ссылка на модель, комментарии, история статусов, файлы и связанные производственные задания.

## PATCH /orders/:id

Изменение статуса, ответственного и внутренних комментариев.

## Безопасность

Публичный сайт не получает права напрямую писать в таблицы БД. Запросы проходят через API. Секреты БД и service-role ключи никогда не помещаются в frontend.

## Версионирование

Публичные endpoints будут размещаться под `/api/v1/`, чтобы будущие изменения не ломали существующие сайты.
