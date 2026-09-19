# Production Farm — Phase 52: actionable risk cockpit

Phase 52 превращает Phase 51 из обзорного dashboard в рабочее место управления рисками.

Он не меняет автоматически деньги, расчёты, договоры, claims или статусы оборудования.

## Операционный SLA

Добавлен внутренний helper:

`private.production_farm_risk_sla_interval(severity)`.

Используется тот же приоритет, что в Phase 50:

- CRITICAL — 4 часа;
- HIGH — 24 часа;
- MEDIUM — 72 часа;
- LOW — 168 часов.

Это **внутренний операционный SLA HUB**, а не юридический/договорный срок.

Phase 52 добавляет SLA/age там, где до этого не было формального due_at:

- PARTNER_DISPUTE — от времени dispute response;
- EQUIPMENT_INCIDENT — от downtime_started_at.

Платежи, contract deadlines, claims и payment integrity сохраняют собственные исходные сроки.

## Actionable risk source

Internal source:

`private.production_farm_actionable_risk_rows(organization_id)`.

Он оборачивает Phase 51 `private.production_farm_risk_rows` и добавляет:

- operational due_at;
- overdue по operational SLA;
- age_minutes;
- operational_sla_hours;
- deep-link с конкретным entity id.

Client execute закрыт.

## Deep links

Cockpit возвращает ссылки:

- PAYMENT_INTEGRITY → `equipment-payment-reconciliation.html?event=<id>`;
- PAYMENT_OBLIGATION → `equipment-payment-control.html?entity_type=...&entity_id=<id>`;
- CONTRACT_DEADLINE → `equipment-contract-deadlines.html?contract=<id>`;
- CONDITION_CLAIM → `equipment-condition-claims.html?claim=<id>`;
- PARTNER_DISPUTE → `equipment-partner-responses.html?response=<id>`;
- EQUIPMENT_INCIDENT → `equipment.html?incident=<id>`.

То есть переход из cockpit сохраняет identity конкретного риска.

## Work items

Таблица:

`production_farm_risk_work_items`.

Хранит только операционную работу cockpit:

- organization;
- category/entity;
- assigned_to / assigned_at;
- acknowledged_by / acknowledged_at;
- last_note.

Direct Data API доступ закрыт.

## Append-only action audit

Таблица:

`production_farm_risk_actions`.

Action types:

- ASSIGNED;
- ACKNOWLEDGED;
- NOTE.

UPDATE/DELETE блокируются:

`PRODUCTION_FARM_RISK_ACTION_APPEND_ONLY`.

Каждое действие содержит actor, note, optional assigned_to, organization/category/entity и event_sequence.

## PAYMENT_INTEGRITY не дублируется

Для payment integrity Phase 50 уже является source of truth.

Поэтому `apply_production_farm_risk_action(...)` делегирует:

ASSIGN →

`assign_equipment_owner_payment_integrity_incident(...)`.

ACK →

`set_equipment_owner_payment_integrity_incident_state(..., 'ACKNOWLEDGED', ...)`.

Generic cockpit audit action всё равно записывается, но assignment/status не дублируются в отдельной модели.

Для остальных категорий assignment/ACK хранится в risk work item.

## Assignees

RPC:

`get_production_farm_risk_assignees()`.

Возвращает только активных сотрудников текущей organization с ADMIN либо одним из:

- equipment.contracts.manage;
- production.settlements.manage;
- equipment.repair;
- production.manage.

## Action RPC

`apply_production_farm_risk_action(category, entity_id, action, assigned_to, note)`.

Доступные actions:

- ASSIGN;
- ACKNOWLEDGE;
- NOTE.

Проверяется:

- auth;
- non-partner staff context;
- current organization;
- manage permission;
- риск всё ещё реально существует в текущем risk source;
- assignee активен и принадлежит той же organization;
- note обязателен.

Cross-tenant entity возвращает:

`RISK_NOT_AVAILABLE`.

## Cockpit payload

`get_production_farm_risk_cockpit(...)` теперь дополнительно возвращает в meta:

- risk_assigned_to;
- risk_assigned_to_name;
- risk_acknowledged;
- risk_acknowledged_at;
- risk_note.

Summary дополнен:

- unassigned;
- acknowledged.

Для PAYMENT_INTEGRITY effective assignment/ACK берутся из существующего Phase 50 workflow.

## Admin UI

`admin/production-farm-risk.js` теперь:

- показывает возраст риска;
- показывает operational SLA;
- показывает ответственного;
- показывает ACK;
- позволяет выбрать same-org assignee;
- позволяет назначить;
- позволяет ACK прямо из карточки;
- после действия перечитывает live cockpit;
- view-only staff продолжает видеть dashboard, даже если RPC списка assignees вернул PERMISSION_DENIED.

## Daily risk digest

Таблица:

`production_farm_risk_digest_runs`.

На organization + date допускается максимум один digest.

Background RPC:

`emit_production_farm_risk_digest()`.

Digest создаётся только если есть:

- CRITICAL;
- HIGH;
- либо overdue.

Уведомления получают только same-org active staff с соответствующими manage permissions / ADMIN.

Повторный запуск в тот же день идемпотентен.

Cron:

`production-farm-risk-digest-daily`

Schedule:

`30 7 * * *`.

## Production rollback test

Тест выполнен внутри `BEGIN ... ROLLBACK`.

Созданы временные:

- A4 LEASE_BUYOUT contract;
- overdue BUYOUT_EXTRA charge;
- Partner A DISPUTED response;
- HIGH equipment incident с downtime_started_at ≈ 25 часов назад.

Проверено:

1. current A4 staff присутствует в assignees;
2. PARTNER_DISPUTE получил due_at и operational SLA = 24h;
3. dispute deep-link содержит конкретный response id;
4. ASSIGN через `apply_production_farm_risk_action`;
5. ACKNOWLEDGE через тот же RPC;
6. cockpit показывает risk_assigned_to;
7. cockpit показывает risk_acknowledged=true;
8. audit содержит ASSIGNED + ACKNOWLEDGED;
9. UPDATE audit action блокируется `PRODUCTION_FARM_RISK_ACTION_APPEND_ONLY`;
10. HIGH downtime 25h помечен overdue при SLA 24h;
11. incident deep-link содержит конкретный incident id;
12. первый digest создаёт одну строку;
13. второй digest в тот же день не создаёт новую строку;
14. digest notifications другой organization = 0;
15. 3D-ARTPRINT не может выполнить action по A4 risk → `RISK_NOT_AVAILABLE`.

Результат:

`phase52_actionable_risk_cockpit_ok`.

После rollback:

- risk work items = 0;
- risk actions = 0;
- digest runs = 0;
- PH52 contracts = 0;
- PH52 incidents = 0.

## Security

Live:

- Production Farm baseline violations = 0;
- private actionable source: anon=false, authenticated=false;
- private append-only guard: anon=false, authenticated=false;
- apply action: anon=false, authenticated=true + staff/org/manage guard;
- assignees: anon=false, authenticated=true + staff/org/manage guard;
- digest emitter: anon=false, authenticated=false;
- all SECURITY DEFINER functions use empty search path.

## Cron verification

Live:

- job: `production-farm-risk-digest-daily`;
- schedule: `30 7 * * *`;
- command: `select public.emit_production_farm_risk_digest();`;
- active=true.

## Next

Phase 53 should make deep links actionable on the destination screens themselves: auto-filter/highlight/focus the exact payment, contract, claim, dispute, incident or integrity event passed in the URL, plus return-link back to cockpit.
