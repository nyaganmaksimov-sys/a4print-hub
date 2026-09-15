# Production Farm — Phase 20: документы страховок/улучшений и audit trail

## Зачем нужен этап

Phase 19 добавил страхование и модернизации оборудования, но поле `document_id` само по себе не решало задачу хранения реальных файлов. Phase 20 связывает этот контур с уже существующим архивом HUB: `document_types`, `documents`, `document_versions`, `document_links` и приватным Supabase Storage.

Новой параллельной модели документов не создаётся.

## Приватный Storage

Создан приватный bucket `hub-documents` с лимитом одного файла 50 МБ.

Разрешены PDF, JPEG/PNG/WebP, Word и Excel. Чтение доступно сотрудникам HUB, загрузка/изменение/удаление — только пользователям с `equipment.manage`.

Пути файлов Phase 20 начинаются с:

`equipment-risk/...`

Это дополнительно проверяется серверным RPC перед регистрацией документа.

## Типы документов

В существующий `document_types` добавлены:

- `EQUIPMENT_INSURANCE` — страховой полис оборудования;
- `EQUIPMENT_IMPROVEMENT` — документ модернизации/улучшения.

## Регистрация файла

`register_equipment_risk_document(...)` выполняется как permission-checked `SECURITY DEFINER` RPC.

После того как браузер успешно загрузил бинарный файл в `hub-documents`, RPC атомарно:

1. проверяет `equipment.manage`;
2. проверяет сущность и путь Storage;
3. создаёт запись в `documents`;
4. создаёт версию `document_versions`;
5. создаёт `document_links` с типом `EQUIPMENT_INSURANCE_POLICY` или `EQUIPMENT_IMPROVEMENT`;
6. сохраняет `document_id` в карточке полиса/улучшения;
7. пишет `DOCUMENT_ATTACHED` в канонический `audit_log`.

Если регистрация после Storage-upload не проходит, frontend удаляет только что загруженный объект, чтобы не оставлять мусорный orphan-файл.

## Чтение документов

`get_equipment_risk_documents()` возвращает только документы страховок и улучшений и требует `equipment.view`.

Функция не раскрывает произвольный архив документов HUB. Для открытия файла UI запрашивает короткую signed URL на 5 минут.

## Audit trail

На `equipment_insurance_policies` и `equipment_improvements` установлены audit triggers.

Для `INSERT / UPDATE / DELETE` в существующий `audit_log` сохраняются:

- `actor_user_id`;
- `actor_auth_user_id`;
- действие;
- тип и ID сущности;
- `old_data`;
- `new_data`;
- время.

Прикрепление документа дополнительно получает отдельное событие `DOCUMENT_ATTACHED`.

Hardening-миграция нужна потому, что live `audit_log` использует канонические поля `old_data/new_data`; это было проверено реальным вызовом, а не только компиляцией функции.

## Интерфейс

В `admin/equipment.html` подключён отдельный модуль:

- `equipment-risk-documents.js`;
- `equipment-risk-documents.css`.

Кнопка **«📎 Документы техники»** открывает архив документов страховок и модернизаций. Можно фильтровать список, загружать файл к конкретному полису/улучшению и открывать уже прикреплённый файл через signed URL.

## Проверка рабочей Supabase

Обе миграции Phase 20 применены к рабочему проекту A4PRINT HUB.

Проверка выполнялась внутри транзакции под реальным ADMIN auth-контекстом:

1. создан временный страховой полис;
2. проверено разрешение `equipment.manage`;
3. вызван `register_equipment_risk_document(...)` с тестовым Storage-путём;
4. созданные `documents`, `document_versions` и `document_links` успешно читаются через `get_equipment_risk_documents()`;
5. `document_id` записан обратно в полис;
6. audit trail содержит создание полиса и прикрепление документа;
7. получен маркер `phase20_risk_documents_audit_ok`;
8. выполнен `ROLLBACK`;
9. после rollback тестовых полисов и документов осталось `0`.

Отдельно подтверждено, что приватный bucket `hub-documents` существует после миграции.

## Миграции

1. `20260915_production_farm_risk_documents_audit.sql`
2. `20260915_production_farm_risk_documents_audit_hardening.sql`
