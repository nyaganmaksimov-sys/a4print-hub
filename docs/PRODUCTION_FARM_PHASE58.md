# Production Farm Phase 58 — QR-код оборудования и быстрые действия

Phase 58 реализует пункт 45 мастер-плана A4PRINT-HUB внутри существующего реестра оборудования и существующего производства.

Новый независимый модуль оборудования, отдельная таблица QR-токенов и отдельная операторская система не создаются.

## Что добавлено

В существующий `admin/equipment.html` добавлен слой `admin/equipment-qr.js`.

Для каждой существующей единицы `equipment_assets` доступен QR-код.

QR содержит обычный authenticated deep link:

`/admin/equipment.html?equipment=<equipment_assets.id>&qr=1`

После сканирования сотрудником:

1. загружается обычный A4PRINT-HUB;
2. действуют существующие auth/RLS/permissions;
3. открывается существующая карточка станка;
4. в карточке появляется блок «Быстрые действия по QR».

## Быстрые действия

Блок по станку показывает текущее или следующее производственное задание из существующего `production_operator_overview`.

Доступные действия зависят от permissions:

- Текущее задание;
- Начать работу;
- Продолжить работу после паузы;
- Завершить работу;
- Обслуживание;
- Сообщить о неисправности;
- Обновить состояние.

START / RESUME / COMPLETE не реализованы повторно.

Они вызывают существующий backend RPC:

`production_operator_action(...)`

Таким образом сохраняются существующие транзакционные проверки Production Farm и единый журнал событий.

## Завершение задания

Для COMPLETE QR-интерфейс спрашивает только необходимые оператору значения:

- годное количество;
- брак;
- переделка;
- комментарий.

После подтверждения данные передаются в существующий `production_operator_action`.

Критичная производственная логика не рассчитывается в новом frontend-коде.

## Обслуживание и неисправность

Phase 58 не создаёт новые формы ТО или инцидентов.

«Обслуживание» переиспользует существующие:

- карточку обслуживания оборудования;
- календарь обслуживания.

«Неисправность» переиспользует существующий `equipment-incidents.js`, который создаёт реальный инцидент и использует текущие permissions.

## Генерация QR

QR строится локально в браузере.

Используется pinned `qrcodejs 1.0.0` через CDN с Subresource Integrity.

Никакой внешний QR API не получает equipment id или ссылку A4PRINT-HUB.

В карточке доступны:

- показать QR;
- скопировать deep link;
- напечатать компактную наклейку с QR, инвентарным номером, названием и местом установки.

## Модель безопасности

QR не является токеном авторизации.

Он содержит только идентификатор существующего объекта.

Доступ к данным определяется существующими механизмами A4PRINT-HUB:

- Supabase Auth;
- RLS;
- organization / tenant scope;
- `get_my_permissions()`;
- permissions существующих production/equipment RPC.

Frontend скрывает недоступные быстрые действия, но реальный доступ дополнительно проверяется backend/RLS.

## Tenant isolation verification

Проверена существующая единица:

- `A4-EQ-00001`;
- equipment id `1bc95be4-c842-4c3a-b528-db324a1a384e`.

Под authenticated staff context A4-Принт:

- equipment visible = 1;
- `equipment.view` = true;
- `production.manage` = true.

Маркер:

`phase58_equipment_qr_a4_visibility_ok`

Под authenticated staff context 3D-ARTPRINT, у которого также есть `equipment.view` и `production.manage`:

- чужой A4 equipment visible = 0.

Маркер:

`phase58_equipment_qr_tenant_isolation_ok`

Это подтверждает, что знание UUID из QR не позволяет прочитать оборудование другой organization.

Все проверки выполнялись без изменения production data.

## Database

Phase 58 не требует миграции.

Источник идентичности остаётся:

`equipment_assets.id`

Это исключает появление второго независимого QR-идентификатора и соответствует правилу мастер-плана о едином источнике данных.

## Mobile acceptance contract

На телефоне после сканирования:

- карточка станка открывается по `equipment` query param;
- быстрые действия адаптируются под узкий экран;
- оператор видит текущую работу;
- разрешённый оператор может START / RESUME / COMPLETE;
- обслуживание и неисправность используют существующие workflows;
- недоступное по permission/RLS оборудование не раскрывается.

## Scope

Phase 58 не меняет:

- orders;
- KASSA;
- warehouse;
- MoySklad;
- settlements;
- partner payments;
- buyout;
- equipment ownership;
- contracts;
- production accounting formulas.

Это интеграционный QR-слой поверх существующих equipment + production + maintenance + incident workflows.
