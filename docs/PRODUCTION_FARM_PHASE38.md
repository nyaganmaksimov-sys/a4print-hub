# Production Farm — Phase 38: production job / dispatch tenant hardening

Phase 38 продолжает multi-company hardening уже за пределами equipment CRUD — в production job/dispatcher контуре.

## Hardened functions

Пустой `search_path` теперь установлен для 12 SECURITY DEFINER функций:

- `auto_dispatch_production_job(...)`;
- `auto_dispatch_production_queue(...)`;
- `configure_production_job(...)`;
- `production_find_dispatch_slot(...)`;
- `production_find_dispatch_slot_internal(...)`;
- `production_operator_action(...)`;
- `production_schedule_job_internal(...)`;
- `schedule_production_job(...)`;
- `schedule_production_job_into_day(...)`;
- `set_production_dispatch_lock(...)`;
- `sync_order_status_from_production(...)`;
- `transition_production_job(...)`.

Client-facing functions остаются закрыты от `anon`. Internal scheduling functions остаются недоступны `authenticated` напрямую.

## Job tenant isolation

Существующие core guards сохранены:

`private.assert_production_job_tenant(p_job_id)`.

Для preferred/manual equipment сохраняются существующие asset tenant guards.

Scheduler internal уже фильтрует candidate equipment по:

`equipment_assets.organization_id = production_jobs.organization_id`.

## Order integrity

`sync_order_status_from_production(uuid)` дополнительно требует:

`private.assert_order_tenant(v_job.order_id,false)`.

Это defense-in-depth поверх существующего trigger, который уже блокирует попытку связать production job одной организации с order другой организации через:

`PRODUCTION_JOB_ORGANIZATION_MISMATCH`.

Также подсчёт незавершённых jobs для перевода order в READY теперь ограничен:

`organization_id = v_job.organization_id`.

## Production rollback test

Тест выполнен внутри `BEGIN ... ROLLBACK`.

В A4-Принт контексте:

1. `production_operator_action(..., NOTE)` успешно создал временное событие;
2. dispatch lock успешно включался и снимался;
3. `sync_order_status_from_production` успешно отработал на своём job/order;
4. `auto_dispatch_production_job` прошёл security envelope и дошёл до штатного business guard `JOB_CANNOT_BE_SCHEDULED`;
5. прямой order guard на 3D-ARTPRINT order → `ORDER_NOT_AVAILABLE`.

Во время первоначального integrity test попытка напрямую подменить `A4 job.order_id` на 3D-ARTPRINT order была ещё раньше остановлена существующим table trigger:

`PRODUCTION_JOB_ORGANIZATION_MISMATCH`.

После переключения на 3D-ARTPRINT с теми же production permissions заблокированы 9 из 9 A4 job-id RPC:

- auto dispatch;
- operator action;
- dispatch lock;
- order-status sync;
- transition;
- find dispatch slot;
- manual schedule;
- schedule into day;
- configure job.

Все → `PRODUCTION_JOB_NOT_AVAILABLE`.

Результат:

`phase38_production_job_dispatch_tenant_hardening_ok`.

После rollback:

`PH38 events = 0`.

## Security verification

Live подтверждено:

- все 12 функций: SECURITY DEFINER;
- все 12 функций: `search_path=''`;
- client job RPC: `anon EXECUTE=false`;
- internal scheduler RPC: `authenticated EXECUTE=false`;
- `sync_order_status_from_production`: job guard + order guard + organization-scoped remaining-job count.
