# Production Farm — Phase 34: tenant guards для выплат владельцам и сроков оплаты

Phase 34 закрывает multi-company риски в owner settlements, lease charges и payment deadlines.

## Что исправлено

### Contract payment tenant helper

Добавлен внутренний helper:

`equipment_payment_contract_tenant_org(uuid)`

Он:

- требует `auth.uid()`;
- читает `equipment_contracts.organization_id`;
- требует `current_user_organization_id()`;
- возвращает `CONTRACT_NOT_AVAILABLE` для чужого договора;
- работает fail-closed через `ORGANIZATION_CONTEXT_REQUIRED`;
- недоступен `anon` и `authenticated` напрямую;
- использует `SECURITY DEFINER` + пустой `search_path`.

### Owner settlements

Tenant helper встроен в:

- `generate_equipment_owner_settlement(...)`;
- `set_equipment_owner_settlement_status(...)`.

Существующая расчётная логика, защита от перекрывающихся периодов, snapshot долей и проверка job duplication не менялись.

Обе функции теперь используют `set search_path=''`, а не `search_path=public`.

### Lease charges

Tenant helper встроен в:

- `generate_equipment_lease_charge(...)`;
- `set_equipment_lease_charge_status(...)`.

Business rules lease/buyout не менялись. Функции также переведены на пустой `search_path`.

### Manual payment deadline

`set_equipment_payment_due_date(...)` теперь перед изменением owner settlement или lease charge получает связанный `contract_id` и проверяет его tenant через общий helper.

Чужая организация не может узнать/изменить due date по известному UUID.

### Staff payment control

`list_equipment_payment_obligations(boolean)`:

- сохраняет intended staff permissions;
- fail-closed требует organization context;
- фильтрует owner settlements и lease charges по `equipment_contracts.organization_id`;
- остаётся `SECURITY INVOKER`, то есть не создаёт лишний privileged read endpoint.

### Deadline events RLS

Policy `equipment_payment_deadline_events_staff_read` теперь дополнительно проверяет tenant исходной сущности:

- `OWNER_SETTLEMENT → equipment_owner_settlements → equipment_contracts.organization_id`;
- `LEASE_CHARGE → equipment_lease_charges → equipment_contracts.organization_id`.

### Cron notifications

`emit_equipment_payment_deadline_notifications()` остаётся внутренним cron-only RPC.

Теперь каждая obligation несёт `contract.organization_id`, а notification recipients выбираются только среди активных пользователей и активных organization units этой организации.

То есть просрочка А4-Принт не создаёт уведомление сотруднику 3D-ARTPRINT даже при одинаковых ролях и permissions.

### Trigger search path

Legacy trigger helpers:

- `touch_owner_settlement()`;
- `touch_equipment_lease_charge()`

переведены с `search_path=public` на пустой `search_path`.

## Production rollback test

Тест выполнен внутри `BEGIN ... ROLLBACK`.

Оба staff-контекста имеют одинаковые права:

- `production.settlements.manage=true`;
- `production.settlements.view=true`;
- `production.buyout.manage=true`;
- `equipment.contracts.manage=true`.

Разница только в tenant:

- А4-Принт;
- 3D-ARTPRINT.

Для А4-Принт созданы временные revenue-share и lease договоры.

В А4-контексте:

1. создан DRAFT owner settlement;
2. создан DRAFT lease charge;
3. обоим назначен due date;
4. `list_equipment_payment_obligations(false)` видит обе записи;
5. lease charge переведён в APPROVED;
6. owner settlement подготовлен в APPROVED для теста emitter;
7. cron-emitter создал два deadline events;
8. все notifications по этим events направлены только пользователям организации А4-Принт;
9. direct RLS SELECT deadline events видит 2 записи.

В контексте 3D-ARTPRINT:

- generate owner settlement по A4 contract → `CONTRACT_NOT_AVAILABLE`;
- generate lease charge по A4 contract → `CONTRACT_NOT_AVAILABLE`;
- изменение owner settlement status → `CONTRACT_NOT_AVAILABLE`;
- изменение lease charge status → `CONTRACT_NOT_AVAILABLE`;
- изменение owner settlement due date → `CONTRACT_NOT_AVAILABLE`;
- изменение lease charge due date → `CONTRACT_NOT_AVAILABLE`;
- payment obligations по тестовым A4 entities → 0;
- direct RLS SELECT deadline events → 0;
- cross-tenant notifications → 0.

Результат:

`phase34_owner_payments_tenant_guards_ok`.

После rollback:

`PH34-% contracts = 0`.

## Security verification

Подтверждено live:

- internal helper: `anon EXECUTE=false`, `authenticated EXECUTE=false`;
- cron emitter: `anon=false`, `authenticated=false`;
- client write RPC: `anon=false`, `authenticated=true` + permission + tenant checks;
- `list_equipment_payment_obligations`: `SECURITY INVOKER`;
- все изменённые functions имеют пустой `search_path`;
- owner settlements / lease charges direct writes для authenticated не открывались;
- deadline events RLS остаётся включённым.

Supabase security advisors после изменения не показали нового Phase 34-specific anonymous exposure. Общепроектные advisor findings по другим модулям остаются отдельным backlog.


## Совместимость с текущим core tenant layer

После синхронизации с актуальным `main` сохранены существующие core guards:

- `private.assert_equipment_contract_tenant(p_contract_id)` в generate owner settlement;
- `private.assert_equipment_contract_tenant(p_contract_id)` в generate lease charge;
- `private.assert_equipment_contract_child_tenant('LEASE_CHARGE',p_charge_id)` в lease status transition.

Phase 34 не заменяет эти проверки, а добавляет второй fail-closed payment-specific tenant layer.

После восстановления core guards выполнен повторный `BEGIN ... ROLLBACK` test:

- собственные generate/due-date/list операции А4-Принт проходят;
- все 6 foreign generate/status/due-date вызовов 3D-ARTPRINT блокируются;
- чужие payment obligations остаются 0.

Результат:

`phase34_owner_payments_core_guard_compat_ok`.
