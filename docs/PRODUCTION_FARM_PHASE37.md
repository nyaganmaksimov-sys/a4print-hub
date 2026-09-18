# Production Farm — Phase 37: internal equipment tenant hardening

Phase 37 закрывает внутренние SECURITY DEFINER helpers/triggers Production Farm после multi-company перехода.

## Найденные реальные риски

### Incident notifications

Старая `notify_equipment_incident(uuid)` выбирала всех активных пользователей с `equipment.repair` без фильтра по организации оборудования.

Это позволяло инциденту А4-Принт создавать notification сотруднику 3D-ARTPRINT.

Исправлено:

- организация берётся из `equipment_assets.organization_id`;
- recipients обязаны иметь активный `organization_unit` той же организации;
- responsible users сохраняют приоритет, но только внутри той же организации;
- repair-permission и ADMIN recipients также ограничены tenant.

### Consumable → inventory bridge

Старая `mirror_equipment_consumable_movement_to_inventory()` выбирала первый активный warehouse глобально.

Исправлено безопасным правилом:

1. активный warehouse текущей `equipment_consumable.organization_id`;
2. если tenant warehouse отсутствует — только global shared warehouse, где `is_shared=true` и `organization_id is null`;
3. warehouse другой организации никогда не выбирается;
4. если безопасного warehouse нет → `INVENTORY_WAREHOUSE_NOT_AVAILABLE`.

Также:

- consumable обязан иметь organization;
- связанный catalog item обязан принадлежать той же organization;
- mismatch блокируется `EQUIPMENT_CONSUMABLE_CATALOG_TENANT_MISMATCH`.

### Consumable catalog bridge

`sync_equipment_consumable_to_catalog()` теперь:

- требует organization_id;
- не позволяет связать consumable одной организации с catalog item другой организации;
- создаёт/обновляет catalog item с organization текущего consumable.

## Internal SECURITY DEFINER hardening

Пустой `search_path` теперь имеют 10 внутренних функций:

- `ensure_equipment_owner_partner_role()`;
- `equipment_incident_status_trigger()`;
- `mirror_equipment_consumable_movement_to_inventory()`;
- `notify_equipment_incident(uuid)`;
- `refresh_equipment_operational_status(uuid)`;
- `replan_production_jobs_after_equipment_fault()`;
- `seed_equipment_capacity_rules()`;
- `sync_equipment_consumable_to_catalog()`;
- `sync_equipment_incident_status(uuid)`;
- `sync_equipment_ownership_history()`.

Все 10 недоступны напрямую `anon` и `authenticated`.

## Shared warehouse policy

На момент Phase 37 в live есть один общий активный склад:

- `Основной склад`;
- `organization_id=NULL`;
- `is_shared=true`.

Tenant-specific warehouse для A4-Принт отсутствовал.

Поэтому Phase 37 не ломает существующий inventory bridge: global shared warehouse разрешён только как fallback. Когда появляется tenant-specific warehouse, он автоматически получает приоритет.

## Production rollback test

Тест выполнен внутри `BEGIN ... ROLLBACK`.

### Warehouse selection

Для действующего A4 consumable:

1. при отсутствии tenant warehouse создано движение;
2. inventory transaction использовал существующий global shared warehouse;
3. внутри транзакции создан tenant-specific A4 warehouse;
4. следующее движение выбрало именно tenant warehouse, а не shared.

### Catalog isolation

Создан временный catalog item 3D-ARTPRINT и предпринята попытка связать его с A4 consumable.

Результат:

`EQUIPMENT_CONSUMABLE_CATALOG_TENANT_MISMATCH`.

### Incident notification isolation

Создан временный incident по оборудованию А4-Принт.

Проверено:

- notifications пользователям 3D-ARTPRINT = 0;
- notifications пользователям А4-Принт > 0.

Результат:

`phase37_internal_equipment_tenant_hardening_ok`.

После rollback:

- PH37 incidents = 0;
- PH37 warehouses = 0;
- PH37 catalog items = 0;
- PH37 consumables = 0;
- PH37 movements = 0;
- PH37 inventory transactions = 0.

## Security verification

Live подтверждено:

- все 10 функций: SECURITY DEFINER;
- все 10 функций: `search_path=''`;
- все 10: `anon EXECUTE=false`;
- все 10: `authenticated EXECUTE=false`;
- notification helper содержит organization-unit tenant scope;
- inventory mirror содержит tenant warehouse scope + global shared fallback;
- catalog bridge и inventory mirror содержат catalog tenant guard.
