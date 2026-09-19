# Production Farm — Phase 44: lease allocation audit и immutable financial snapshot

Phase 44 превращает temporal allocation Phase 43 из внутренней формулы в проверяемый рабочий процесс для сотрудника и владельца.

## Цель

Для каждого арендного начисления должно быть видно:

- какое оборудование участвовало в расчётном периоде;
- сколько active days пришлось на каждый аппарат;
- сколько исторических периодов состава попало в расчёт;
- какой effective weight использован;
- какая доля charge пришлась на аппарат;
- какая сумма аренды и buyout credit относится к аппарату.

После согласования начисления эта раскладка не должна меняться задним числом.

## Allocation snapshot

В `equipment_lease_charges` добавлены:

- `allocation_snapshot jsonb`;
- `allocation_snapshot_at`;
- `allocation_snapshot_by`;
- `allocation_document_id`.

Snapshot schema:

`equipment_lease_allocation_v1`.

Он содержит:

- charge / contract / partner;
- период;
- currency;
- исходную сумму начисления;
- исходный buyout credit;
- сумму распределённых начислений;
- сумму распределённого buyout credit;
- массив `allocations` по каждому apparatus.

По каждой позиции фиксируются:

- equipment_id;
- inventory number / name / brand / model / serial;
- first/last active date;
- active_days;
- period_count;
- effective_weight;
- total_effective_weight;
- allocation_ratio;
- allocated_amount;
- allocated_buyout_credit_amount.

## Snapshot builder

Внутренняя функция:

`private.build_equipment_lease_charge_allocation_snapshot(uuid)`.

Она строит snapshot только из `equipment_lease_charge_allocations`.

Перед сохранением проверяется:

- allocation не пуст;
- сумма `allocated_amount` совпадает с `equipment_lease_charges.amount` с допуском 0.01;
- сумма allocated buyout credit совпадает с charge buyout credit.

Ошибки:

- `LEASE_ALLOCATION_EMPTY`;
- `LEASE_ALLOCATION_TOTAL_MISMATCH`;
- `LEASE_ALLOCATION_CREDIT_MISMATCH`.

## Когда snapshot фиксируется

`set_equipment_lease_charge_status(...)` при переходе:

`DRAFT → APPROVED`

для `charge_type='LEASE'`:

1. строит allocation snapshot;
2. создаёт архивный финансовый документ;
3. сохраняет snapshot, timestamp, actor и document id;
4. только после этого переводит charge в APPROVED.

PAID для обычного lease charge невозможен без snapshot:

`LEASE_ALLOCATION_SNAPSHOT_REQUIRED`.

## Финансовый документ

Document type:

`EQ_LEASE_CHARGE` — «Начисление аренды оборудования».

Документ создаётся в момент APPROVED и содержит:

- contract id/number/type;
- partner snapshot;
- immutable allocation snapshot;
- period start/end;
- сумму начисления;
- buyout credit;
- links на charge, contract, partner;
- links на каждое equipment из allocation.

Document schema:

`equipment_lease_charge_document_v1`.

Документ сразу имеет статус ACTIVE, потому что он фиксирует уже утверждённое начисление, а не проект соглашения.

## Immutable guard

Trigger:

`private.guard_equipment_lease_charge_allocation_snapshot()`.

После появления snapshot запрещено менять напрямую:

- allocation_snapshot;
- allocation_snapshot_at;
- allocation_snapshot_by;
- allocation_document_id.

Ошибка:

`LEASE_ALLOCATION_SNAPSHOT_IMMUTABLE`.

Для APPROVED/PAID также immutable:

- contract;
- partner;
- charge_type;
- period;
- amount;
- buyout credit;
- currency.

Ошибка:

`APPROVED_LEASE_CHARGE_IMMUTABLE`.

## Controlled detail RPC

Добавлен:

`get_equipment_lease_charge_allocation(uuid)`.

### Staff

Staff с production/equipment financial permission:

- для DRAFT получает `mode=LIVE_PREVIEW`;
- preview строится из текущей temporal allocation view;
- для APPROVED/PAID получает `mode=SNAPSHOT`.

### Partner

Partner context:

- проходит contract-child tenant guard;
- может получить только charge своего partner_id;
- если snapshot ещё не опубликован, получает:

`LEASE_ALLOCATION_NOT_PUBLISHED`.

То есть владелец не видит изменяемый внутренний расчёт DRAFT.

После APPROVED получает только immutable snapshot.

Partner B не может прочитать Partner A charge.

## Partner cabinet

`get_partner_equipment_cabinet()` теперь возвращает для lease charge:

- allocation_snapshot;
- allocation_snapshot_at;
- allocation_document_id.

Архив документов владельца включает `EQ_LEASE_CHARGE`.

`get_partner_equipment_document()` разрешает владельцу открыть этот тип документа.

## Admin UI

В оборудование добавлен отдельный модуль:

`admin/equipment-lease-allocation-audit.js`.

Кнопка:

**📊 Раскладка аренды**

Показывает все lease charges текущего tenant.

Для DRAFT:

**Предпросмотр** — live calculation.

Для APPROVED/PAID:

**Раскладка** — immutable snapshot.

Таблица показывает:

- аппарат;
- active days / period count;
- effective weight;
- percentage;
- allocated lease;
- allocated buyout credit.

## Partner UI

Добавлен модуль:

`partner/equipment-owner-lease-allocations.js`.

Во вкладке «Начисления и выплаты» владелец видит отдельный блок:

**Расшифровка арендных начислений**.

Показываются только charges с опубликованным allocation snapshot.

Владелец может:

- открыть детальную раскладку;
- увидеть суммы по каждому аппарату;
- открыть архивный документ `EQ_LEASE_CHARGE`.

## Production rollback test

Полный тест выполнен внутри `BEGIN ... ROLLBACK`.

Контрольный temporal case:

- charge = **1 000 ₽**;
- buyout credit = **100 ₽**;
- аппарат A = 20 active days в 2 периодах;
- аппарат B = 30 active days в 1 периоде;
- weights = 1 / 1.

До APPROVED:

- staff detail RPC → `LIVE_PREVIEW`;
- A = **400 ₽**;
- B = **600 ₽**;
- buyout credit = **40 ₽ / 60 ₽**;
- Partner A preview → `LEASE_ALLOCATION_NOT_PUBLISHED`.

После APPROVED:

- allocation_snapshot создан;
- allocation_document_id создан;
- snapshot total = 1 000 ₽;
- snapshot credit total = 100 ₽;
- document type = `EQ_LEASE_CHARGE`;
- document metadata содержит `equipment_lease_charge_document_v1`;
- allocation metadata содержит `equipment_lease_allocation_v1`;
- прямая попытка изменить snapshot → `LEASE_ALLOCATION_SNAPSHOT_IMMUTABLE`;
- staff detail RPC → `SNAPSHOT`;
- Partner A detail RPC → `SNAPSHOT`;
- Partner A открывает архивный document и видит allocation snapshot;
- Partner B заблокирован.

Результат:

`phase44_lease_allocation_audit_ok`.

После rollback:

- PH44 assets = 0;
- PH44 contracts = 0;
- PH44 charges = 0;
- PH44 documents = 0.

## Security

Live:

- Production Farm security baseline violations = 0;
- private snapshot builder: anon=false, authenticated=false;
- private document creator: anon=false, authenticated=false;
- immutable trigger helper: anon=false, authenticated=false;
- public detail RPC: anon=false, authenticated=true;
- public detail RPC: SECURITY DEFINER + empty search path;
- child contract tenant guard обязателен;
- partner context ограничен своим partner_id.

Supabase advisor может отмечать public detail RPC как authenticated SECURITY DEFINER endpoint. Это intentional read API; anonymous exposure отсутствует, а tenant/partner scope проверяется внутри функции.
