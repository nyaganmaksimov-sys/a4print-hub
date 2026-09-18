# Production Farm — Phase 49: persistent owner payment integrity incidents

Phase 49 превращает reconciliation/integrity detection в постоянный incident workflow.

Он не исправляет деньги, cash transactions или ledger автоматически.

## Repo drift

В live Supabase до Phase 49 уже существовали:

- `private.equipment_owner_payment_integrity_rows()`;
- `equipment_owner_payment_integrity_events`;
- `get_equipment_owner_payment_integrity(...)`;
- `emit_equipment_owner_payment_integrity_notifications()`;
- cron `equipment-owner-payment-integrity-daily`.

В main полноценной migration не было.

Phase 49 фиксирует этот baseline в репозитории и расширяет его до incident workflow.

## Incident table

`equipment_owner_payment_integrity_events`.

Хранит:

- entity type/id;
- contract / partner / organization;
- issue signature;
- issue codes;
- integrity snapshot;
- status;
- first seen (`detected_at`);
- last seen;
- occurrence count;
- resolved_at.

Статусы:

- OPEN;
- ACKNOWLEDGED;
- RESOLVED.

Direct Data API access для anon/authenticated закрыт.

## Append-only actions

Добавлена:

`equipment_owner_payment_integrity_actions`.

Action types:

- ACKNOWLEDGED;
- RESOLVED;
- REOPENED.

Каждая запись содержит note/reference/actor/time/sequence.

UPDATE и DELETE блокируются:

`OWNER_PAYMENT_INTEGRITY_ACTION_APPEND_ONLY`.

## Rescan

RPC:

`rescan_equipment_owner_payment_integrity()`.

Интерактивный вызов:

- staff-only;
- partner-context запрещён;
- нужен equipment.contracts.manage или production.settlements.manage.

Background/cron вызов разрешён без auth-context.

Поведение:

1. current ERROR с новым signature → новый OPEN incident;
2. существующий OPEN/ACK → last_seen + occurrence_count;
3. RESOLVED с тем же signature снова появился → REOPENED + OPEN;
4. проблема исчезла → RESOLVED автоматически;
5. auto-resolution пишет action:
   - note: успешная повторная сверка;
   - reference: `AUTO_RECONCILIATION_OK`.

Никаких cash/ledger mutations функция не делает.

## Notifications

Новый/reopened incident создаёт WARNING notification только staff текущей organization с правами:

- production.settlements.manage;
- equipment.contracts.manage;
- ADMIN.

Старый cron wrapper сохранён:

`emit_equipment_owner_payment_integrity_notifications()`

и теперь вызывает controlled rescan.

## Daily cron

Сохраняется job:

`equipment-owner-payment-integrity-daily`

Schedule:

`45 6 * * *`

Command:

`select public.emit_equipment_owner_payment_integrity_notifications();`

## Staff list RPC

`list_equipment_owner_payment_integrity_incidents(include_resolved default false)`.

Возвращает только текущую organization.

В payload:

- issue codes/signature;
- OPEN/ACKNOWLEDGED/RESOLVED;
- first/last seen;
- occurrence count;
- latest action/comment/reference/actor;
- current integrity state;
- current issue codes;
- current signature match.

## Staff state RPC

`set_equipment_owner_payment_integrity_incident_state(event_id,state,note,reference)`.

Разрешены:

- ACKNOWLEDGED;
- RESOLVED.

RESOLVED разрешён только если конкретный issue signature больше не активен.

Иначе:

`INTEGRITY_ISSUE_STILL_ACTIVE`.

Для RESOLVED обязателен reference.

## Admin UI

На странице Phase 48 «Сверка выплат» добавлен блок:

**Инциденты сверки**.

Можно:

- показать/скрыть resolved;
- вручную запустить rescan;
- ACK «Принять в работу»;
- закрыть incident после исправления;
- видеть first/last seen и occurrence count;
- видеть current integrity state и latest staff comment.

Файл:

`admin/equipment-payment-integrity-incidents.js`.

## Production rollback test

Внутри `BEGIN ... ROLLBACK`:

1. временный LEASE contract + APPROVED lease charge;
2. выплата через реальный Phase 47 payment RPC;
3. original cash transaction намеренно изменена 1000 → 999;
4. rescan создал OPEN incident, occurrence=1;
5. staff → ACKNOWLEDGED с комментарием;
6. повторный rescan сохранил ACK и occurrence=2;
7. cash transaction восстановлена 999 → 1000;
8. rescan автоматически перевёл incident в RESOLVED;
9. append-only actions содержат ACKNOWLEDGED + RESOLVED;
10. RESOLVED action имеет `AUTO_RECONCILIATION_OK`;
11. 3D staff не видит A4 incident.

Результат:

`phase49_owner_payment_integrity_incidents_ok`.

После rollback:

- PH49 contracts = 0;
- PH49 charges = 0;
- integrity events/actions = 0.

## Security

Live:

- Production Farm security baseline violations = 0;
- events/actions RLS enabled;
- direct anon/authenticated SELECT/INSERT/UPDATE/DELETE = false;
- private integrity rows: anon=false, authenticated=false;
- private append-only guard: anon=false, authenticated=false;
- emit cron wrapper: anon=false, authenticated=false;
- rescan: anon=false, authenticated=true + staff permission guard;
- incident list/state RPC: anon=false, authenticated=true + organization scope.

## Следующий этап

Phase 50 — integrity escalation/SLA:

- severity by issue code;
- due_at / overdue;
- assignment owner;
- notification escalation;
- operating dashboard;
- без автоматического изменения денег.
