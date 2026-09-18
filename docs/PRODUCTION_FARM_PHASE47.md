# Production Farm — Phase 47: immutable owner payment ledger

Phase 47 закрывает последний участок между утверждённым обязательством владельцу и фактической денежной операцией.

Phase 44/45 уже фиксируют immutable audit snapshot начисления. Phase 47 делает таким же проверяемым сам факт выплаты и сторно.

## Repo drift

Во время аудита обнаружено, что live Supabase уже содержит базовый owner-payment ledger:

- `equipment_owner_payment_postings`;
- `get_equipment_owner_payment_financial_options(...)`;
- `post_equipment_owner_payment_financial_transaction(...)`;
- `reverse_equipment_owner_payment_financial_transaction(...)`;
- PAID guard для settlement/lease charge.

Но соответствующей полноценной migration в `main` не было.

Phase 47 устраняет drift: migration содержит весь существующий live baseline и новый immutable/audit слой, поэтому новая база может воспроизвести текущую production-схему из репозитория.

## Ledger

Таблица:

`equipment_owner_payment_postings`.

Каждая запись связывает:

- OWNER_SETTLEMENT или LEASE_CHARGE;
- договор;
- владельца;
- организацию;
- сумму и валюту;
- cash account;
- исходную cash transaction;
- payment reference;
- actor/time;
- optional reversal cash transaction;
- reversal reason/reference/actor/time.

Активная выплата уникальна по:

`entity_type + entity_id WHERE reversed_at IS NULL`.

Прямой Data API доступ закрыт:

- anon SELECT/INSERT/UPDATE/DELETE = false;
- authenticated SELECT/INSERT/UPDATE/DELETE = false;
- RLS enabled.

## PAID только через ledger

Trigger:

`private.guard_equipment_owner_payment_paid_status()`.

Для положительного OWNER_SETTLEMENT / LEASE_CHARGE переход в PAID допускается только внутри controlled payment-ledger context.

Прямая попытка поставить PAID без cash posting получает:

`PAYMENT_LEDGER_POSTING_REQUIRED`.

## Immutable / append-only guard

Добавлен:

`private.guard_equipment_owner_payment_posting_ledger()`.

### INSERT

Разрешён только controlled payment RPC.

Иначе:

`OWNER_PAYMENT_LEDGER_CONTROLLED_WRITE_REQUIRED`.

### DELETE

Запрещён всегда:

`OWNER_PAYMENT_LEDGER_APPEND_ONLY`.

### UPDATE

Core posting fields immutable:

- entity;
- contract / partner / organization;
- amount / currency;
- cash account;
- original cash transaction;
- payment reference;
- note;
- posting actor/time.

Ошибка:

`OWNER_PAYMENT_LEDGER_CORE_IMMUTABLE`.

Разрешён только первый controlled переход к reversal state.

После сторно reversal fields также immutable:

`OWNER_PAYMENT_LEDGER_REVERSAL_IMMUTABLE`.

## Posting RPC

`post_equipment_owner_payment_financial_transaction(...)`:

1. staff-only context;
2. contract child tenant guard;
3. APPROVED obligation required;
4. immutable Phase 44/45 audit snapshot required;
5. cash account обязан принадлежать той же organization и валюте;
6. создаётся EXPENSE cash transaction;
7. создаётся ledger posting;
8. audit document связывается с cash transaction;
9. obligation переводится в PAID.

Для OWNER_SETTLEMENT используется сумма `owner_amount`.

Для LEASE_CHARGE используется сумма `amount`.

## Reversal RPC

`reverse_equipment_owner_payment_financial_transaction(...)`:

1. obligation должен быть PAID;
2. находится active posting;
3. проверяется исходная EXPENSE transaction;
4. создаётся INCOME reversal transaction;
5. ledger row получает reversal fields;
6. audit document связывается со сторно;
7. obligation возвращается в APPROVED.

Original posting не удаляется и не переписывается.

## Partner ledger RPC

Добавлен:

`get_my_equipment_owner_payment_ledger()`.

Partner получает только строки своего `current_partner_id()`.

Возвращаются:

- contract;
- entity type/id;
- period;
- amount/currency;
- payment reference;
- transaction date;
- POSTED / REVERSED;
- reversal reference/reason/date;
- audit document id;
- lease charge type.

Cash account details владельцу не раскрываются.

Другой partner не видит запись.

## Staff UI

Экран:

`admin/equipment-payment-control.html`.

В обязательстве появляется:

**Выплата / ledger**

или для PAID:

**История выплаты**.

Staff может:

- выбрать cash account;
- указать дату;
- указать платёжный документ;
- провести выплату;
- посмотреть history;
- выполнить сторно с обязательной причиной и основанием.

Client не создаёт cash transaction напрямую — только вызывает controlled RPC.

## Partner UI

Во вкладке:

**Начисления и выплаты**

добавлен блок:

**Фактические выплаты**.

Владелец видит:

- договор;
- тип выплаты;
- период;
- сумму;
- дату;
- payment reference;
- статус ВЫПЛАЧЕНО / СТОРНО;
- причину и основание сторно;
- ссылку на immutable расчётный документ Phase 44/45.

## Production rollback test

Тест выполнен внутри `BEGIN ... ROLLBACK`.

Созданы временные:

- equipment asset;
- LEASE contract;
- contract asset period;
- lease charge.

Charge переведён в APPROVED, при этом создан Phase 44 allocation snapshot/document.

Затем:

1. staff провёл выплату через BANK cash account;
2. cash transaction создана;
3. ledger posting создан;
4. charge → PAID;
5. прямой UPDATE payment reference ledger row заблокирован;
6. прямой DELETE ledger row заблокирован;
7. Partner A увидел запись как POSTED и audit document id;
8. Partner B запись не увидел;
9. staff выполнил reversal;
10. reversal cash transaction создана;
11. charge вернулся в APPROVED;
12. Partner A увидел ту же ledger row как REVERSED с reference/reason/date.

Результат:

`phase47_owner_payment_ledger_audit_ok`.

Все тестовые данные откатились.

## Security

Live после Phase 47:

- Production Farm security baseline violations = 0;
- ledger table direct anon/authenticated access = false;
- private context helper = anon false / authenticated false;
- private paid-status guard = anon false / authenticated false;
- private immutable ledger guard = anon false / authenticated false;
- staff options/post/reverse RPC = anon false / authenticated true;
- partner ledger RPC = anon false / authenticated true;
- staff RPC используют contract child tenant guard и organization check;
- partner RPC фильтрует строго current_partner_id.

## Следующий этап

После Phase 47 расчёт → audit snapshot → cash posting → reversal полностью прослеживается.

Следующий логичный этап — reconciliation: автоматическая сверка obligation status, ledger posting и cash transaction с сигналом, если trusted SQL/import нарушил цепочку или cash transaction была изменена отдельно.
