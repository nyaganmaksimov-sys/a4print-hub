# Production Farm — Phase 47: staff-context hardening

Phase 47 закрывает отдельный класс privilege-escalation внутри multi-company A4PRINT HUB: partner account может находиться в той же organization, что и staff, и при ошибочно назначенной роли иметь staff permissions.

Organization tenant guard в такой ситуации недостаточен: organization совпадает, permission=true, но пользователь всё равно работает в partner-context и не должен получать административный equipment/production API.

## Новый context guard

Добавлен internal helper:

`private.assert_no_partner_context()`.

Правила:

- `auth.uid() IS NULL` → разрешено, чтобы не ломать доверенные background/service executions;
- authenticated user + `current_partner_id() IS NULL` → разрешено;
- authenticated user + `current_partner_id() IS NOT NULL` → `STAFF_CONTEXT_REQUIRED`.

Helper:

- SECURITY DEFINER;
- `search_path=''`;
- недоступен `public`, `anon`, `authenticated`.

Phase 46 helper `assert_non_partner_staff_context()` остаётся более строгим для юридического amendment lifecycle и не заменяется.

## Staff API audit

Перед hardening найдено ровно **60** public authenticated SECURITY DEFINER equipment/production RPC, которые:

- используют `has_permission(...)`;
- не имеют собственной partner-context логики;
- не являются `get_my_*`;
- не являются partner response endpoints;
- ещё не используют staff-context guard.

Из них:

- **59** реализованы на PL/pgSQL;
- **1** — SQL-language: `get_equipment_risk_documents()`.

Миграция автоматически добавляет `perform private.assert_no_partner_context();` в 59 PL/pgSQL RPC.

`get_equipment_risk_documents()` переведён в эквивалентный PL/pgSQL SECURITY DEFINER wrapper с тем же result set и явным context guard.

После migration:

`remaining staff API without partner-context guard = 0`.

## Какие контуры закрыты

Guard теперь распространяется на административные API следующих классов:

- production dispatch / scheduling / operator actions;
- production material planning and costs;
- equipment ownership / capacity / standards;
- equipment incidents and repair;
- condition inspections and files;
- contract termination;
- lease/buyout operations;
- owner settlement generation/status/due dates;
- condition claim create/resolve/financial posting/reversal/repost;
- risk documents;
- contract document status;
- production settings.

Owner-facing API не патчились:

- `get_my_*`;
- partner response RPC;
- owner financial/detail RPC, которые уже имеют собственную `current_partner_id()` логику.

## Persistent security baseline

Phase 41 DB baseline расширен новым violation:

`PARTNER_CONTEXT_STAFF_API`.

Violation создаётся, если public equipment/production SECURITY DEFINER RPC:

- executable authenticated;
- содержит `has_permission(...)`;
- не обрабатывает `current_partner_id()`;
- не использует `assert_non_partner_staff_context()`;
- не использует `assert_no_partner_context()`.

После Phase 47:

- `PARTNER_CONTEXT_STAFF_API = 0`;
- общий Production Farm security baseline violations = **0**.

## PR regression checker

`.github/scripts/check-production-farm-security-baseline.py` также расширен.

Для новой/изменённой public equipment/production SECURITY DEFINER функции с `has_permission(...)` CI требует один из markers:

- `current_partner_id(`;
- `assert_non_partner_staff_context(`;
- `assert_no_partner_context(`.

То есть новый staff RPC без явной границы partner/staff больше не сможет пройти PR.

## Production rollback test

Тест выполнен внутри `BEGIN ... ROLLBACK`.

### Background/service

При `auth.uid() IS NULL`:

`private.assert_no_partner_context()` проходит без ошибки.

Это сохраняет trusted/background execution.

### Обычный A4 staff

Проверены representative staff API:

- `get_equipment_risk_documents()`;
- `get_equipment_condition_claim_financial_integrity(false)`;
- `save_production_monitor_settings(...)`;
- `auto_dispatch_production_job(...)`.

Они проходят context guard и доходят до штатного чтения/бизнес-логики.

### Partner A

Partner A продолжает использовать:

`get_my_equipment_contract_amendments()`.

Одновременно пять staff API блокируются раньше permission/entity logic:

1. risk documents;
2. claim financial integrity;
3. production monitor settings mutation;
4. equipment capacity mutation;
5. production auto-dispatch.

Все → `STAFF_CONTEXT_REQUIRED`.

### Partner B

Тот же набор из пяти staff API также:

`STAFF_CONTEXT_REQUIRED`.

Это важно, потому что у Partner B live-account действительно обнаружено `equipment.contracts.manage=true` при активном `current_partner_id()`.

Результат:

`phase47_staff_context_hardening_ok`.

## Verification

Live подтверждено:

- staff APIs без partner-context guard после migration: **0**;
- Production Farm baseline violations: **0**;
- representative guarded functions: `search_path=''`, anon=false;
- owner `get_my_*` API остаются рабочими;
- trusted/background helper execution сохранено.

Supabase Advisor по затронутым объектам продолжает отмечать `get_equipment_risk_documents()` как intentional authenticated SECURITY DEFINER endpoint. Это ожидаемо: endpoint нужен staff UI, но теперь ограничен permission, organization tenant и explicit no-partner-context guard.
