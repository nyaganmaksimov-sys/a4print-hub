# Production Farm — Phase 36: equipment mutation tenant hardening

Phase 36 закрывает оставшийся legacy security envelope у клиентских mutation RPC оборудования, production standards и incidents.

## Изменённые RPC

Пустой `search_path` установлен для:

- `link_equipment_incident_document(...)`;
- `record_equipment_incident_repair(...)`;
- `report_equipment_incident(...)`;
- `save_equipment_capacity(...)`;
- `save_equipment_ownership(...)`;
- `save_production_equipment_capabilities(...)`;
- `save_production_equipment_standard(...)`;
- `update_equipment_incident(...)`.

Все восемь остаются intentional authenticated SECURITY DEFINER mutation endpoints с собственными permission checks.

## Tenant guards

Существующие core guards сохранены:

- asset mutations → `private.assert_equipment_asset_tenant(...)`;
- incident mutations → `private.assert_equipment_incident_tenant(...)`;
- responsible staff → существующий staff tenant guard.

Дополнительно `report_equipment_incident` теперь, если передан `p_production_job_id`, выполняет:

`private.assert_production_job_tenant(p_production_job_id)`.

Это блокирует чужой production job до чтения и изменения job/run state.

## Generic documents

`link_equipment_incident_document` защищён tenant guard самого incident.

При этом таблица `documents` сейчас не имеет `organization_id` и использует общий HUB staff access. Поэтому полноценная tenant-модель generic documents является отдельным архитектурным долгом; Phase 36 не имитирует несуществующую принадлежность документа.

## Production rollback test

Тест выполнен внутри `BEGIN ... ROLLBACK`.

Оба staff-контекста имеют одинаковые права:

- `production.manage=true`;
- `equipment.repair=true`;
- `equipment.ownership.manage=true`.

В А4-Принт контексте успешно выполнены:

1. save capacity;
2. save ownership;
3. save production capabilities;
4. save production standard;
5. report incident;
6. update incident;
7. record incident repair;
8. link incident document.

Отдельно в A4 incident был передан существующий production job 3D-ARTPRINT. Вызов остановлен:

`PRODUCTION_JOB_NOT_AVAILABLE`.

После переключения на 3D-ARTPRINT попытки изменить A4 equipment/incident заблокированы:

- capacity → `EQUIPMENT_NOT_AVAILABLE`;
- ownership → `EQUIPMENT_NOT_AVAILABLE`;
- capabilities → `EQUIPMENT_NOT_AVAILABLE`;
- standard → `EQUIPMENT_NOT_AVAILABLE`;
- report incident → `EQUIPMENT_NOT_AVAILABLE`;
- update incident → `EQUIPMENT_INCIDENT_NOT_AVAILABLE`;
- repair → `EQUIPMENT_INCIDENT_NOT_AVAILABLE`;
- incident document link → `EQUIPMENT_INCIDENT_NOT_AVAILABLE`.

Итого 8 из 8 cross-tenant mutation paths blocked.

Результат:

`phase36_equipment_mutation_tenant_hardening_ok`.

После rollback:

- PH36 incidents = 0;
- PH36 documents = 0;
- PH36 standards = 0;
- PH36 service rows = 0.

## Security verification

Live подтверждено:

- все 8 RPC: SECURITY DEFINER;
- все 8 RPC: `search_path=''`;
- все 8 RPC: `anon EXECUTE=false`;
- authenticated EXECUTE остаётся только как управляемый application API;
- asset/incident guards присутствуют;
- `report_equipment_incident`: asset guard + production job guard.

Business rules функций не переписывались.
