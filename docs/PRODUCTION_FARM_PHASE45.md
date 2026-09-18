# Production Farm — Phase 45: owner settlement audit и immutable revenue-share snapshot

Phase 45 даёт расчётам доли владельца тот же уровень проверяемости, который Phase 44 дал арендным начислениям.

## Цель

После согласования revenue-share периода должно быть доказуемо:

- какие production jobs вошли в расчёт;
- на каком оборудовании они выполнялись;
- какая выручка операции использована;
- сколько фактически получено;
- какие прямые расходы учтены;
- какая split base получилась;
- сколько начислено владельцу;
- сколько осталось HUB.

После APPROVED ни агрегаты, ни строки расчёта не должны меняться задним числом.

## Settlement snapshot

В `equipment_owner_settlements` добавлены:

- `settlement_snapshot jsonb`;
- `settlement_snapshot_at`;
- `settlement_snapshot_by`;
- `settlement_document_id`.

Snapshot schema:

`equipment_owner_settlement_v1`.

В snapshot фиксируются условия расчёта и все финансовые итоги:

- calculation_basis;
- owner/hub share percent;
- direct_costs_before_split;
- gross revenue;
- received revenue;
- direct costs;
- split base;
- owner amount;
- HUB amount;
- line count.

## Snapshot lines

Каждая строка содержит:

- settlement line id;
- production job id/title;
- equipment id, inventory number, name, brand/model/serial;
- order id/number;
- completed_at;
- operation revenue;
- received revenue;
- direct costs;
- split base;
- owner amount;
- HUB amount.

Snapshot builder:

`private.build_equipment_owner_settlement_snapshot(uuid)`.

Перед публикацией он сверяет сумму всех строк с header settlement по шести финансовым показателям с допуском 0.01.

Ошибки:

- `OWNER_SETTLEMENT_SNAPSHOT_EMPTY`;
- `OWNER_SETTLEMENT_SNAPSHOT_MISMATCH:...`.

## APPROVED lifecycle

`set_equipment_owner_settlement_status(...)` при:

`DRAFT → APPROVED`

выполняет:

1. существующую проверку непустого периода;
2. существующую защиту от повторного включения production job;
3. построение settlement snapshot;
4. создание финансового документа;
5. фиксацию snapshot timestamp/actor/document;
6. переход в APPROVED.

Переход APPROVED → PAID требует существующий snapshot:

`OWNER_SETTLEMENT_SNAPSHOT_REQUIRED`.

## Финансовый документ

Добавлен document type:

`EQ_OWNER_SETTLEMENT` — «Расчёт доли владельца оборудования».

Document schema:

`equipment_owner_settlement_document_v1`.

Документ содержит:

- contract id/number/type;
- partner snapshot;
- полный immutable settlement snapshot.

Создаются document links на:

- owner settlement;
- equipment contract;
- partner;
- каждое equipment;
- каждый production job.

Документ имеет ACTIVE status, так как фиксирует уже утверждённый расчёт.

## Immutable header

Trigger:

`private.guard_equipment_owner_settlement_snapshot()`.

После snapshot запрещено менять:

- snapshot;
- snapshot timestamp;
- snapshot actor;
- document id.

Ошибка:

`OWNER_SETTLEMENT_SNAPSHOT_IMMUTABLE`.

После APPROVED/PAID также immutable финансовое ядро:

- contract / partner;
- period;
- calculation basis;
- gross/received revenue;
- direct costs;
- split base;
- owner/HUB amounts;
- owner/HUB shares;
- direct-cost rule;
- currency.

Ошибка:

`APPROVED_OWNER_SETTLEMENT_IMMUTABLE`.

## Immutable lines

Trigger:

`private.guard_equipment_owner_settlement_line_immutable()`.

После APPROVED/PAID или появления snapshot запрещены INSERT/UPDATE/DELETE строк:

`APPROVED_OWNER_SETTLEMENT_LINES_IMMUTABLE`.

Это предотвращает расхождение между архивным snapshot и operational table.

## Controlled detail RPC

Добавлен:

`get_equipment_owner_settlement_detail(uuid)`.

### Staff

Staff с settlements/equipment permission:

- DRAFT → `LIVE_PREVIEW`;
- APPROVED/PAID → `SNAPSHOT`.

### Partner

Partner:

- проходит `private.assert_equipment_contract_child_tenant('OWNER_SETTLEMENT',...)`;
- видит только settlement своего partner id;
- до APPROVED не получает preview:

`OWNER_SETTLEMENT_NOT_PUBLISHED`.

После публикации получает только immutable snapshot.

Partner B не может открыть Partner A settlement.

## Partner cabinet

`get_partner_equipment_cabinet()` теперь возвращает:

- settlement_snapshot;
- settlement_snapshot_at;
- settlement_document_id.

В архив документов владельца добавлен тип:

`EQ_OWNER_SETTLEMENT`.

`get_partner_equipment_document()` разрешает владельцу открыть этот документ.

## Admin UI

Добавлен:

`admin/production-farm-settlement-audit.js`.

В Production workspace появляется кнопка:

**📋 Аудит доли**

Для каждого расчёта:

- DRAFT → «Предпросмотр»;
- APPROVED/PAID → «Раскладка».

Детальный экран показывает:

- production job и equipment;
- order/completed time;
- operation revenue;
- received revenue;
- direct cost;
- split base;
- owner amount;
- HUB amount.

## Partner UI

Добавлен:

`partner/equipment-owner-settlement-audit.js`.

Во вкладке «Начисления и выплаты»:

**Расшифровка доли с выручки**.

Показываются только settlements с опубликованным snapshot.

Владелец может:

- открыть детальную раскладку;
- проверить каждую производственную строку;
- открыть архивный `EQ_OWNER_SETTLEMENT` document.

## Production rollback test

Тест выполнен внутри `BEGIN ... ROLLBACK`.

Контрольный production job:

- operation revenue = **1 000 ₽**;
- production cost = **200 ₽**;
- order отсутствует;
- calculation basis = OPERATION_REVENUE;
- direct_costs_before_split = false;
- owner share = 30%;
- HUB share = 70%.

Сгенерированный settlement:

- gross revenue = **1 000 ₽**;
- received revenue = **0 ₽**;
- direct costs = **200 ₽**;
- split base = **1 000 ₽**;
- owner = **300 ₽**;
- HUB = **700 ₽**.

До APPROVED:

- staff detail → LIVE_PREVIEW;
- line count = 1;
- owner/HUB line = 300 / 700;
- Partner A → `OWNER_SETTLEMENT_NOT_PUBLISHED`.

После APPROVED:

- settlement snapshot создан;
- document id создан;
- document type = EQ_OWNER_SETTLEMENT;
- document schema = equipment_owner_settlement_document_v1;
- snapshot schema = equipment_owner_settlement_v1;
- прямая mutation snapshot → `OWNER_SETTLEMENT_SNAPSHOT_IMMUTABLE`;
- mutation settlement line → `APPROVED_OWNER_SETTLEMENT_LINES_IMMUTABLE`;
- staff detail → SNAPSHOT;
- Partner A detail → SNAPSHOT;
- Partner A открывает документ;
- Partner B blocked.

После перехода PAID snapshot остался byte-for-byte неизменным.

Результат:

`phase45_owner_settlement_audit_ok`.

После rollback:

- PH45 assets = 0;
- PH45 contracts = 0;
- PH45 production jobs = 0;
- PH45 settlements = 0;
- PH45 documents = 0.

## Security

Live:

- Production Farm security baseline violations = 0;
- private snapshot builder: anon=false, authenticated=false;
- private document creator: anon=false, authenticated=false;
- private header guard: anon=false, authenticated=false;
- private line guard: anon=false, authenticated=false;
- public detail RPC: anon=false, authenticated=true;
- public detail RPC: SECURITY DEFINER + empty search path;
- child contract tenant guard обязателен;
- partner context ограничен своим partner_id.

Phase 45 не создаёт платеж автоматически. PAID по-прежнему является отдельным явным staff action с payment reference.
