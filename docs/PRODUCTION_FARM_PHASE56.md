# Production Farm — Phase 56: server-side triage и пагинация risk cockpit

Phase 56 закрывает точностной пробел Phase 55.

До Phase 56 cockpit получал максимум 20 рисков на категорию через:

`get_production_farm_risk_cockpit(20)`

и уже после этого браузер применял фильтры:

- Мои риски;
- Без ответственного;
- ACK;
- category;
- severity;
- overdue;
- search.

При наличии более 20 рисков одной категории нужная запись могла не попасть в browser payload и поэтому исчезнуть из triage, хотя в базе она оставалась активной.

Phase 56 переносит фильтрацию **до LIMIT/OFFSET** на сервер.

## Новый page RPC

Public Data API:

`get_production_farm_risk_cockpit_page(category, severity, overdue_only, triage, search, limit, offset)`.

Поддерживаемые фильтры:

- category — 6 известных risk categories;
- severity — CRITICAL / HIGH / MEDIUM / LOW;
- overdue_only;
- triage — MINE / UNASSIGNED / ACK;
- search — максимум 120 символов;
- limit — 1..100;
- offset — 0..5000.

Фильтрация выполняется по полному tenant-scoped risk source до пагинации.

## MINE

`MINE` сравнивается с:

`current_staff_user_id()`

в базе.

Frontend больше не получает staff profile только ради фильтрации списка и не пытается сравнивать Auth UUID с internal staff user id.

## Ответ RPC

RPC возвращает:

- `summary` — глобальная сводка по всем активным рискам организации;
- `filtered_summary` — сводка после применённых фильтров;
- `items` — текущая страница;
- `page.offset`;
- `page.limit`;
- `page.returned`;
- `page.total`;
- `page.has_more`;
- normalized `filters`.

Глобальные KPI cockpit поэтому продолжают показывать общую картину организации, а список работает по server-side triage.

## Порядок

Стабильная сортировка:

1. severity: CRITICAL → HIGH → MEDIUM → LOW;
2. overdue;
3. due_at;
4. sort_at;
5. category;
6. entity_id.

Это позволяет безопасно использовать offset pagination без случайной перестановки одинаковых строк между загрузками.

## UI

`production-farm-risk.js` теперь вызывает только:

`get_production_farm_risk_cockpit_page`.

Client-side `state.items.filter(...)` для triage/search/category/severity/overdue удалён.

Добавлено:

- `Найдено N · показано X`;
- filtered overdue count;
- кнопка `Показать ещё`;
- page size = 50;
- server offset = уже показанное количество строк;
- search debounce 250 ms;
- повторная загрузка не теряется, если фильтр изменён во время уже идущего RPC;
- отказ `get_production_farm_risk_assignees` для read-only сотрудника не повторяется на каждом фильтре.

Phase 55 URL/deep-link state сохраняется без изменений.

## Доказательство проблемы top-20

Rollback test создал 25 временных PAYMENT_OBLIGATION рисков одной категории A4-Принт.

Самый старый риск:

- находился за пределами первых 20;
- был назначен текущему staff;
- был ACK.

Проверено:

старый RPC:

`get_production_farm_risk_cockpit(20)`

**не вернул** этот риск.

Новый RPC:

`triage=MINE`

вернул ровно этот риск.

Это подтверждает, что Phase 56 исправляет реальный gap, а не только меняет presentation layer.

Результат:

`phase56_server_side_triage_pagination_ok`.

## Пагинация и triage test

В том же rollback:

- MINE total = 1;
- UNASSIGNED total = 24;
- UNASSIGNED limit 10 → returned 10, has_more=true;
- ACK total = 1;
- общий filtered total = 25;
- offset 20 / limit 10 → returned 5, has_more=false;
- `filtered_summary.total=25`;
- 3D-ARTPRINT по поиску временных A4 risks → 0.

После security hardening весь сценарий повторён через финальный public wrapper:

`phase56_server_side_triage_hardened_ok`.

После rollback PH56 test contracts = 0.

## Security architecture

Первая реализация public RPC была SECURITY DEFINER. Supabase Security Advisor корректно отметил её как authenticated privileged endpoint.

Финальная модель использует Phase 54 pattern.

### Private reader

`risk_private.get_production_farm_risk_cockpit_page(...)`

- SECURITY DEFINER;
- `search_path=''`;
- auth required;
- non-partner staff context;
- current organization;
- existing risk-view permissions;
- strict tenant source;
- anon EXECUTE=false;
- authenticated EXECUTE=true только на конкретную функцию.

### Public wrapper

`public.get_production_farm_risk_cockpit_page(...)`

- SECURITY INVOKER;
- `search_path=''`;
- только вызывает private reader;
- anon EXECUTE=false;
- authenticated EXECUTE=true.

Browser не получает direct SELECT к risk work tables.

## Tenant isolation

A4 ↔ 3D rollback verification:

- A4 видит свои PH56 test risks;
- 3D получает total=0 по тому же поиску;
- assignee name дополнительно возвращается только если organization unit пользователя совпадает с текущей organization.

## Verification

Live после финальной migration:

- `phase56_server_side_triage_pagination_ok`;
- `phase56_server_side_triage_hardened_ok`;
- public wrapper SECURITY DEFINER = false;
- private reader SECURITY DEFINER = true;
- public/private empty search path;
- anon EXECUTE = false;
- Production Farm security baseline violations = 0;
- Supabase Security Advisor findings для page RPC = 0;
- PH56 rollback residue = 0.

Phase 56 не меняет деньги, ledger, договоры, claims, partner responses или статусы оборудования.

## Next

После точной server-side triage логичный следующий операционный этап — сохранённые представления / быстрые пресеты cockpit и персональная рабочая очередь без изменения доменных risk objects.
