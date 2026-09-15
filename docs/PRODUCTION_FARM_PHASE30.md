# Production Farm — Phase 30: контроль целостности финансовой цепочки требований

Phase 30 добавляет независимую read-only проверку финансовых цепочек, созданных Phase 27–29. Она не исправляет деньги автоматически и не меняет `cash_transactions`.

## Что считается финансовой правдой

Фактический денежный эффект считается непосредственно по реальным source-tagged строкам `cash_transactions`, независимо от audit-таблиц:

- original: `external_source='EQUIPMENT_CONDITION_CLAIM'` + `external_id=claim_id`;
- reversal: `external_source='EQUIPMENT_CONDITION_CLAIM_REVERSAL'` + `external_id=original_transaction_id`;
- repost: `external_source='EQUIPMENT_CONDITION_CLAIM_REPOST'` + `external_id=claim_id`.

Audit-записи reversals/reposts проверяются отдельно как доказательство корректной связи и процедуры. Поэтому потерянный audit не скрывает реально прошедшее движение денег и не искажает actual net effect.

Для каждого `SETTLED`-требования и каждой цепочки, где уже есть финансовые операции, система также сверяет:

- согласованную `settled_amount`;
- организацию оборудования;
- валюту cash account;
- направление `INCOME` / `EXPENSE`;
- счёт сторно относительно исходного счёта;
- external source / external id связи;
- фактический и ожидаемый net effect.

## Состояния цепочки

- `PENDING_POSTING` — требование урегулировано, финансовой проводки ещё нет;
- `ACTIVE` — действует исходная Phase 27-проводка;
- `REVERSED` — исходная операция компенсирована фактическим сторно, ожидаемый net effect равен 0;
- `REPOSTED` — после сторно существует фактическая исправленная Phase 29-проводка.

`PENDING_POSTING` само по себе не является нарушением.

## Нарушения

Integrity checker выявляет в том числе:

- финансовую операцию у требования не в `SETTLED`;
- потерянный original;
- несовпадение суммы, организации, валюты или направления original;
- reversal без audit;
- audit reversal, который ссылается на отсутствующую transaction;
- `REVERSAL_EXTERNAL_TRANSACTION_MISSING` — audit reversal есть, а фактической source-tagged reversal transaction нет;
- неправильную связь reversal с original;
- неверную сумму, направление, счёт или организацию сторно;
- repost без reversal;
- repost без audit;
- audit repost, который ссылается на отсутствующую transaction;
- `REPOST_EXTERNAL_TRANSACTION_MISSING` — audit repost есть, а фактической source-tagged repost transaction нет;
- неправильную связь repost с reversal;
- несовпадение суммы, организации, валюты или направления repost;
- `NET_EFFECT_MISMATCH` — фактический денежный эффект по source-tagged `cash_transactions` не совпадает с ожидаемым.

## Серверные функции

Внутренний helper `equipment_condition_claim_financial_integrity_rows()` строит проверочную модель. EXECUTE для `anon` и `authenticated` у helper закрыт.

Пользовательский read-RPC:

`get_equipment_condition_claim_financial_integrity(boolean)`

доступен только авторизованному сотруднику с одним из прав просмотра/управления оборудованием или расчётами.

Фоновый emitter:

`emit_equipment_claim_financial_integrity_notifications()`

не доступен клиентам и запускается только серверным cron.

Все SECURITY DEFINER функции используют `set search_path=''`.

## События и уведомления

Таблица `equipment_condition_claim_financial_integrity_events` хранит обнаруженные сигнатуры нарушений. Она включена в RLS; клиент имеет только разрешённый SELECT, прямые INSERT/UPDATE/DELETE закрыты.

После hardening события append-only. Trigger guard выдаёт `CONDITION_CLAIM_FINANCIAL_INTEGRITY_EVENT_APPEND_ONLY` на update/delete.

Сигнатура включает набор ошибок, id original/reversal/repost и фактический net effect. Поэтому повторное ежедневное сканирование не создаёт одинаковые уведомления повторно.

Cron:

- job: `equipment-claim-financial-integrity-daily`;
- schedule: `30 6 * * *`;
- 06:30 UTC ежедневно;
- command: `select public.emit_equipment_claim_financial_integrity_notifications();`.

При новом нарушении WARNING получают ADMIN и сотрудники с `production.settlements.manage` или `equipment.contracts.manage`.

## HUB UI

Добавлен read-only экран:

`admin/equipment-condition-claim-integrity.html`

Он доступен прямой кнопкой `Контроль целостности` из экрана финансовых корректировок.

Экран показывает KPI, состояние цепочки, согласованную сумму, original/reversal/repost, actual net effect, expected net effect и понятные русские описания обнаруженных кодов ошибок. Есть поиск, фильтр состояния и режим `Только нарушения`.

## Transaction tests

Основной инъекционный тест выполнен внутри `BEGIN ... ROLLBACK` штатной полной цепочкой inspection → comparison → claim → cash transactions.

В reversal намеренно было поставлено то же направление, что и у original. Контроль обнаружил:

- `REVERSAL_DIRECTION_MISMATCH`;
- `NET_EFFECT_MISMATCH`;
- actual net effect = 200;
- expected net effect = 0.

Первый вызов background emitter создал событие, повторный вызов создал 0 дублей.

Результат: `phase30_claim_financial_integrity_ok`.

Отдельный hardening-сценарий проверил реальную source-tagged reversal transaction без audit-записи. Фактический и ожидаемый net effect остались 0/0, система сообщила `REVERSAL_AUDIT_MISSING`, но не создала ложный `NET_EFFECT_MISMATCH`.

Результат: `phase30_external_truth_without_audit_ok`.

После rollback: residual assets = 0, contracts = 0, claims = 0, cash transactions = 0, integrity events = 0.
