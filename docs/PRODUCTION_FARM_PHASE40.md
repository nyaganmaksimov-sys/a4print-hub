# Production Farm — Phase 40: production materials / costing hardening

Phase 40 закрывает materials, inventory bridge и costing/execution helpers Production Farm.

## Найденный риск

До Phase 40 material RPC выбирали warehouse так:

`ORDER BY is_shared DESC`.

То есть global shared warehouse получал приоритет над warehouse текущей организации.

Для multi-company это могло смешивать production inventory между A4-Принт и 3D-ARTPRINT.

## Safe warehouse rule

`production_material_action(...)` и `save_production_job_material_plan(...)` теперь используют единое правило:

1. активный warehouse, где `warehouse.organization_id = production_job.organization_id`;
2. если такого нет — global shared warehouse с `is_shared=true AND organization_id IS NULL`;
3. warehouse другой организации запрещён;
4. material catalog item обязан принадлежать той же organization, что и job.

Tenant warehouse всегда имеет приоритет над shared fallback.

## Client RPC hardening

- `production_material_action(...)`;
- `save_production_job_material_plan(...)`;
- `set_production_material_cost(...)`.

Все:

- SECURITY DEFINER;
- `search_path=''`;
- anon EXECUTE=false;
- сохраняют job/catalog/warehouse tenant guards.

## Internal costing/execution hardening

Пустой search path установлен также для:

- `close_production_job_pause(...)`;
- `log_production_job_run_event()`;
- `log_production_job_status_without_run()`;
- `on_production_job_status_sync_order()`;
- `production_job_events_recalculate()`;
- `production_job_machine_recost()`;
- `production_job_materials_recost()`;
- `production_job_materials_touch()`;
- `recalculate_production_job_cost(...)`;
- `recalculate_production_job_machine_time(...)`;
- `recalculate_production_job_operator_totals(...)`;
- `sync_order_to_production_job()`;
- `sync_production_job_execution()`.

Всего Phase 40 охватывает 16 SECURITY DEFINER функций.

## Order sync defense-in-depth

`on_production_job_status_sync_order()` при подсчёте незавершённых jobs теперь дополнительно ограничивает строки:

`organization_id = new.organization_id`.

Это дополняет уже существующий job/order organization trigger.

## Production rollback test

Тест выполнен внутри `BEGIN ... ROLLBACK`.

A4-Принт:

1. без tenant warehouse material plan выбрал global shared warehouse;
2. создан временный A4 tenant warehouse;
3. повторный material plan автоматически выбрал tenant warehouse;
4. в tenant warehouse временно добавлен stock;
5. `production_material_action(... ISSUE ...)` списал материал именно из tenant warehouse;
6. inventory transaction также записан на tenant warehouse;
7. `set_production_material_cost` успешно прошёл security envelope.

3D-ARTPRINT:

- A4 material plan → `PRODUCTION_JOB_NOT_AVAILABLE`;
- A4 material action → `PRODUCTION_JOB_NOT_AVAILABLE`;
- A4 material cost update → `CATALOG_ITEM_NOT_AVAILABLE`.

Результат:

`phase40_production_materials_costing_hardening_ok`.

После rollback:

- PH40 warehouses = 0;
- PH40 material rows = 0;
- PH40 inventory rows = 0;
- исходная цена материала восстановлена.

До миграции существующих `production_job_materials` не было, поэтому historical unsafe warehouse rows отсутствовали.

## Security verification

Live подтверждено:

- все 16 функций: `search_path=''`;
- 3 client RPC: anon=false;
- internal helpers/triggers: authenticated=false;
- material plan/action: job guard + catalog guard + warehouse guard + tenant warehouse priority;
- order sync trigger: organization-scoped remaining-job count.
