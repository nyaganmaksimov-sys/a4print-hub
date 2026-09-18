# Production Farm — Phase 46: allocation weight annex

Phase 46 добавляет юридически контролируемое изменение `allocation_weight` оборудования в действующем договоре.

## Зачем это нужно

Phase 43/44 распределяют lease charge по формуле:

`active_days × allocation_weight`.

После Phase 42 прямой UPDATE состава ACTIVE/SUSPENDED договора блокируется:

`ACTIVE_CONTRACT_EQUIPMENT_CHANGE_REQUIRES_NEW_ANNEX`.

До Phase 46 легального workflow изменения `allocation_weight` не было.

Прямое изменение веса также опасно исторически: оно могло бы переписать вес всей текущей строки периода задним числом.

## Новый amendment kind

Добавлен:

`EQUIPMENT_ALLOCATION_WEIGHT`.

Staff создаёт ДС через:

`create_equipment_allocation_weight_amendment(contract_id,effective_on,changes,reason)`.

Каждая строка changes содержит:

- equipment_id;
- новый allocation_weight;
- optional note.

При создании фиксируются:

- source contract asset period;
- previous allocation weight;
- new allocation weight;
- equipment snapshot;
- before legal snapshot.

Document schema:

`equipment_contract_allocation_weight_amendment_v1`.

Используется существующий document type `EQ_CONTRACT_AMENDMENT` и существующий lifecycle:

`DRAFT → APPROVED → SIGNED → APPLIED`.

## Temporal split

Применение выполняет:

`private.apply_equipment_contract_allocation_weight_amendment(uuid)`.

Если effective date позже начала текущего equipment period:

1. текущий period закрывается на `effective_on - 1`;
2. создаётся новый period с `starts_on=effective_on`;
3. новый period получает новый allocation_weight;
4. старый и новый periods связываются с amendment через source/ended-by fields.

Если текущий period уже начинается ровно в effective date, weight меняется в этой строке: прошлых дней у такого period нет, поэтому retroactive rewrite не возникает.

Audit row сохраняет source/result contract_asset_id и old/new weight.

## Audit table

Добавлена:

`equipment_contract_amendment_allocations`.

Колонки включают:

- amendment / contract / partner / equipment;
- source_contract_asset_id;
- result_contract_asset_id;
- previous_allocation_weight;
- new_allocation_weight;
- equipment_snapshot;
- note.

Таблица имеет RLS и полностью закрыта от прямого `anon/authenticated` SELECT/INSERT/UPDATE/DELETE.

## Staff-context hardening

Во время production test обнаружен важный edge case: partner account может одновременно иметь staff permissions.

Такой partner-context находился в той же organization и мог пройти обычный organization tenant guard.

Добавлен internal helper:

`private.assert_non_partner_staff_context()`.

Если `current_partner_id() IS NOT NULL`, staff-only lifecycle RPC возвращает:

`STAFF_CONTEXT_REQUIRED`.

Guard добавлен в:

- create_equipment_contract_amendment;
- create_equipment_composition_amendment;
- create_equipment_allocation_weight_amendment;
- approve_equipment_contract_amendment;
- cancel_equipment_contract_amendment;
- apply_equipment_contract_amendment;
- record_equipment_contract_amendment_signature;
- mark_equipment_contract_amendment_signed.

Также `list_equipment_contract_amendments` теперь staff-only и явно фильтрует текущую organization.

Partner flow продолжает использовать:

- `get_my_equipment_contract_amendments()`;
- partner acceptance/response RPC;
- controlled amendment document RPC.

## Admin UI

На странице допсоглашений появляется кнопка:

**+ Изменить веса**

Модуль:

`admin/equipment-contract-allocation.js`.

Staff выбирает:

- ACTIVE/SUSPENDED договор;
- effective date;
- один или несколько действующих аппаратов;
- новый weight;
- optional comment;
- основание.

UI показывает текущий weight и не позволяет отправить unchanged/zero weight.

## Owner UI

Владелец видит amendment kind:

**Изменение распределения**

В списке и документе показывается:

`оборудование · старый вес → новый вес`.

Partner acceptance использует существующий workflow подтверждения.

## Production rollback test

Тест выполнен внутри `BEGIN ... ROLLBACK`.

Контрольный договор:

- аппарат A: weight 1;
- аппарат B: weight 1;
- contract starts 10 дней назад;
- amendment effective today;
- A меняется 1 → 2.

### Direct mutation guard

Прямой UPDATE weight по ACTIVE договору:

`ACTIVE_CONTRACT_EQUIPMENT_CHANGE_REQUIRES_NEW_ANNEX`.

### Period split

После APPROVED + PAPER signature + APPLIED:

- A old period: 10 дней, weight 1, ends yesterday;
- A new period: starts today, weight 2;
- audit row: previous=1, new=2, result_contract_asset_id заполнен.

### Temporal lease allocation

Lease charge:

- period: 10 дней до today + 10 дней с today;
- amount: 1 000 ₽.

Effective weights:

- A: 10×1 + 10×2 = 30;
- B: 20×1 = 20.

Allocation:

- A = **600 ₽**;
- B = **400 ₽**.

После APPROVED Phase 44 snapshot также содержит 600/400 и total 1 000 ₽.

### Partner visibility

Partner A:

- видит amendment kind `EQUIPMENT_ALLOCATION_WEIGHT`;
- видит одну `equipment_weight_change` строку.

Partner B:

- amendment в `get_my_*` не видит.

### Partner-context cannot become staff

Partner A и Partner B при наличии staff permissions:

- staff amendment list → `STAFF_CONTEXT_REQUIRED`;
- approve/create staff mutation → `STAFF_CONTEXT_REQUIRED`.

Результат:

`phase46_allocation_weight_annex_ok`.

После rollback:

- PH46 assets = 0;
- PH46 contracts = 0;
- PH46 amendments = 0;
- PH46 charges = 0.

## Security verification

Live подтверждено:

- Production Farm security baseline violations = 0;
- new public create RPC: SECURITY DEFINER + empty search path;
- new public create RPC: anon=false, authenticated=true;
- private apply helper: anon=false, authenticated=false;
- private staff-context helper: anon=false, authenticated=false;
- audit table direct client access = false;
- amendment lifecycle mutations содержат staff-context guard.

## Supabase Advisor

После Phase 46 advisor показывает два ожидаемых сигнала:

- `rls_enabled_no_policy` для `equipment_contract_amendment_allocations` — намеренно: таблица не имеет client-facing policies и полностью закрыта прямому доступу;
- `authenticated_security_definer_function_executable` для `create_equipment_allocation_weight_amendment(...)` — intentional application RPC; внутри обязательны `equipment.contracts.manage`, organization tenant guard и `assert_non_partner_staff_context()`.

Неожиданных Phase 46-specific findings нет.
