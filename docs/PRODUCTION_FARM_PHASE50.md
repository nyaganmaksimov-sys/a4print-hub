# Production Farm — Phase 50: integrity SLA, assignment and escalation

Phase 50 делает payment-integrity incidents операционно управляемыми.

Он не исправляет cash transactions, ledger или obligations автоматически.

## Severity

Добавлен internal helper:

`private.equipment_owner_payment_integrity_severity(issue_codes)`.

Приоритеты:

- CRITICAL — отсутствие сущности/active posting, multiple postings, organization mismatch;
- HIGH — transaction missing, active posting on non-paid, amount/account/direction mismatch;
- MEDIUM — остальные integrity issues;
- LOW — пустой issue set.

Severity вычисляется системой, а не выбирается оператором.

## SLA

`private.equipment_owner_payment_integrity_sla_interval(severity)`:

- CRITICAL — 4 часа;
- HIGH — 24 часа;
- MEDIUM — 72 часа;
- LOW — 168 часов.

В event добавлены:

- severity;
- due_at;
- assigned_to;
- assigned_at;
- last_escalated_at;
- escalation_count.

Новый/reopened incident получает новый SLA. Повторный scan активного incident не двигает due_at.

## Assignment

RPC:

`get_equipment_owner_payment_integrity_assignees()`

возвращает только активных сотрудников текущей organization с ADMIN либо:

- equipment.contracts.manage;
- production.settlements.manage.

RPC:

`assign_equipment_owner_payment_integrity_incident(event_id,assigned_to,note)`.

Проверяет:

- staff-context;
- organization;
- права;
- active same-org assignee;
- incident не RESOLVED.

Пишет append-only action `ASSIGNED` и notification ответственному.

## Escalation

Action types Phase 49 расширены:

- ASSIGNED;
- ESCALATED.

Background function:

`escalate_equipment_owner_payment_integrity_incidents()`.

Она обрабатывает OPEN/ACKNOWLEDGED incidents, у которых:

- due_at < now;
- последняя эскалация отсутствует либо была более 12 часов назад.

При эскалации:

- last_escalated_at обновляется;
- escalation_count++;
- пишется append-only ESCALATED action;
- уведомляется assignee;
- уведомляются ADMIN и staff с manage permissions той же organization.

Деньги не меняются.

## Hourly cron

Job:

`equipment-owner-payment-integrity-escalation-hourly`

Schedule:

`15 * * * *`

Command:

`select public.escalate_equipment_owner_payment_integrity_incidents();`

Daily rescan Phase 49 остаётся отдельно на 06:45.

## Incident list

`list_equipment_owner_payment_integrity_incidents(...)` теперь возвращает:

- severity;
- due_at;
- is_overdue;
- assigned_to / assigned_to_name;
- assigned_at;
- escalation_count;
- last_escalated_at.

Сортировка:

1. CRITICAL;
2. HIGH;
3. MEDIUM;
4. LOW;
5. overdue first;
6. OPEN перед ACKNOWLEDGED.

## Admin UI

`admin/equipment-payment-integrity-incidents.js` расширен.

В карточке видно:

- severity;
- SLA deadline;
- ПРОСРОЧЕНО;
- escalation count;
- assignee;
- dropdown назначения.

KPI:

- CRITICAL;
- HIGH;
- Просрочено;
- Без ответственного.

## Production rollback test

Тест выполнен внутри `BEGIN ... ROLLBACK`.

1. создан временный LEASE contract + APPROVED charge;
2. выполнена реальная Phase 47 выплата;
3. original cash amount 1000 → 999;
4. rescan создал incident;
5. issue `ORIGINAL_AMOUNT_MISMATCH` классифицирован HIGH;
6. due_at ≈ +24 часа;
7. incident назначен текущему оператору;
8. создан ASSIGNED action;
9. test-only due_at сдвинут на час в прошлое;
10. escalation function создала ESCALATED;
11. escalation_count = 1;
12. cash amount восстановлен 999 → 1000;
13. rescan автоматически RESOLVED;
14. history содержит ASSIGNED → ESCALATED → RESOLVED;
15. 3D staff не видит A4 incident.

Результат:

`phase50_integrity_sla_escalation_ok`.

После rollback:

- PH50 contracts = 0;
- PH50 charges = 0;
- PH50 events = 0.

## Security

Live:

- Production Farm baseline violations = 0;
- severity/SLA helpers client execute = false;
- escalation function client execute = false;
- assignment/assignee/list/rescan RPC: anon=false, authenticated=true;
- all public staff RPC use empty search path and staff/organization guards;
- events/actions remain direct-client inaccessible.

## Cron verification

Live active jobs:

- `equipment-owner-payment-integrity-daily` — 45 6 * * *;
- `equipment-owner-payment-integrity-escalation-hourly` — 15 * * * *.

## Next

Phase 51 — Production Farm risk cockpit: overdue integrity incidents, unpaid obligations, contract deadlines, claims, disputes and downtime in one tenant-scoped operational dashboard.
