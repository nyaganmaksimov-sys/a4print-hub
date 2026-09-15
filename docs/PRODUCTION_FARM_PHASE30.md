# Production Farm — Phase 30: контроль целостности финансовой цепочки требований

Phase 30 добавляет независимую read-only проверку финансовых цепочек, созданных Phase 27–29. Она не исправляет деньги автоматически и не меняет `cash_transactions`.

## Что контролируется

Для каждого `SETTLED`-требования и каждой цепочки, где уже есть финансовые операции, система сверяет:

- исходную операцию `EQUIPMENT_CONDITION_CLAIM`;
- audit и операцию сторно `EQUIPMENT_CONDITION_CLAIM_REVERSAL`;
- audit и исправленную операцию `EQUIPMENT_CONDITION_CLAIM_REPOST`;
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
- `REVERSED` — исходная операция компенсирована сторно, ожидаемый net effect равен 0;
- `REPOSTED` — после сторно создана исправленная Phase 29-проводка.

`PENDING_POSTING` само по себе не является нарушением.

## Нарушения

Integrity checker выявляет в том числе:

- финансовую операцию у требования не в `SETTLED`;
- потерянный original;
- несовпадение суммы, организации, валюты или направления original;
- reversal без audit или audit без reversal transaction;
- неправильную связь reversal с original;
- неверную сумму, направление, счёт или организацию сторно;
- repost без reversal;
- repost без audit или audit без transaction;
- неправильную связь repost с reversal;
- несовпадение суммы, организации, валюты или направления repost;
- `NET_EFFECT_MISMATCH` — фактический финансовый эффект не совпадает с ожидаемым.

## Серверные функции

Внутренний helper `equipment_condition_claim_financial_integrity_rows()` строит проверочную модель по фактическим таблицам. EXECUTE для `anon` и `authenticated` у helper закрыт.

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

## Transaction test

Инъекционный тест выполнен внутри `BEGIN ... ROLLBACK` штатной полной цепочкой inspection → comparison → claim → cash transactions.

В reversal намеренно было поставлено то же направление, что и у original. Контроль обнаружил:

- `REVERSAL_DIRECTION_MISMATCH`;
- `NET_EFFECT_MISMATCH`;
- actual net effect = 200;
- expected net effect = 0.

Первый вызов background emitter создал событие, повторный вызов создал 0 дублей.

Результат: `phase30_claim_financial_integrity_ok`.

После rollback: residual assets = 0, contracts = 0, claims = 0, cash transactions = 0, integrity events = 0.
