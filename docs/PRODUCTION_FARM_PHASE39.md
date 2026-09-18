# Production Farm — Phase 39: tenant-scoped production settings

Phase 39 переводит dispatcher и production monitor settings с глобального singleton на multi-company модель.

## Проблема

До Phase 39:

- `production_dispatch_settings` имел единственную строку с `id=1`;
- `production_monitor_settings` имел единственную строку с `id=true`;
- любой staff с `production.manage` менял общие настройки для всех организаций;
- internal dispatcher читал global row `where id=1`.

Для A4-Принт и 3D-ARTPRINT это означало общий planning horizon, timezone, setup gap и monitor thresholds.

## Схема

В обе таблицы добавлен обязательный `organization_id`.

Старые compatibility markers сохранены:

- dispatch rows по-прежнему имеют `id=1`;
- monitor rows по-прежнему имеют `id=true`.

Но primary key теперь:

`organization_id`.

Текущее singleton-значение было скопировано каждой активной организации, поэтому миграция не меняет стартовые настройки.

После миграции live содержит две строки в каждой settings table:

- А4-Принт;
- 3D-ARTPRINT.

Обе получили прежние baseline значения.

## RLS

`production_dispatch_settings_read` теперь требует:

- текущую organization;
- production view / analytics / manage permission.

`production_monitor_settings_staff_read` теперь требует:

- текущую organization;
- production view / analytics permission.

Прямые UPDATE для authenticated по-прежнему не открыты.

## Save RPC

`save_production_dispatch_settings(...)` и `save_production_monitor_settings(...)`:

- требуют auth;
- fail-closed требуют `current_user_organization_id()`;
- сохраняют только строку текущей organization;
- используют `ON CONFLICT(organization_id)`;
- SECURITY DEFINER с `search_path=''`;
- anon EXECUTE=false.

## Dispatcher internal

`production_find_dispatch_slot_internal(...)` теперь читает:

`production_dispatch_settings.organization_id = production_jobs.organization_id`.

Это важно и для доверенного background execution, где нельзя полагаться только на caller RLS.

## Monitor view

`production_equipment_monitor` уже использует `security_invoker=true`.

После tenant-aware RLS settings CTE автоматически получает только monitor settings текущей organization.

## Production rollback test

Тест выполнен внутри `BEGIN ... ROLLBACK`.

В A4-Принт:

- dispatch timezone временно изменён на `Europe/Berlin`;
- horizon → 21;
- setup gap → 17;
- monitor lookback → 45;
- utilization threshold → 82;
- service due → 10;
- direct RLS SELECT видит ровно 1 dispatch row и 1 monitor row.

После переключения на 3D-ARTPRINT:

- direct RLS SELECT также видит ровно по 1 своей строке;
- A4 rows не видны;
- 3D значения остались baseline: `Asia/Yekaterinburg`, horizon 30, setup gap 10;
- monitor baseline 30 / 85 / 14 не изменился.

Дополнительно подтвержден explicit filter internal dispatcher по `v_job.organization_id`.

Результат:

`phase39_production_settings_tenancy_ok`.

После rollback обе организации сохранили одинаковые исходные baseline значения.

## Security verification

Live подтверждено:

- обе settings tables имеют tenant-aware RLS;
- обе таблицы содержат по одной строке на активную organization;
- save RPC: empty search path + org guard;
- internal dispatcher: authenticated EXECUTE=false + explicit organization filter.
