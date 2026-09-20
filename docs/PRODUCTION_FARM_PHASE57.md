# Production Farm Phase 57 — saved risk cockpit presets

Phase 57 продолжает мастер-план A4PRINT-HUB без создания нового раздела или независимой системы.

Цель этапа: превратить Phase 55–56 risk cockpit в персональную рабочую очередь, где сотрудник может сохранить часто используемые фильтры и открыть cockpit сразу в нужном представлении.

## Что добавлено

В существующий `admin/production-farm-risk.html` добавлены персональные сохранённые представления:

- выбрать сохранённое представление;
- применить;
- сохранить текущие фильтры;
- обновить существующее;
- назначить / снять представление по умолчанию;
- удалить;
- сбросить фильтры.

Сохраняются только разрешённые cockpit-фильтры:

- `q`;
- `category`;
- `severity`;
- `triage`;
- `overdue`.

Пресет не содержит и не меняет доменные risk objects, деньги, ledger, договоры, claims, partner responses, equipment state или assignment/ACK history.

## URL и deep links

Phase 55 URL/deep-link contract сохранён.

При загрузке страницы:

1. URL-фильтры читаются первыми.
2. Персональные пресеты загружаются с backend.
3. Default preset применяется только если в URL нет явных `q/category/severity/triage/overdue`.
4. Если cockpit открыт через deep link или сохранённый URL с фильтрами, default preset его не перезаписывает.

Таким образом возврат из конкретного риска продолжает восстанавливать исходное triage-state.

## Backend и безопасность

Источник истины для presets — backend.

Таблица:

`public.production_farm_risk_presets`

Scope каждой записи:

`organization_id + user_id`.

Прямой доступ Data API к таблице закрыт:

- RLS включён;
- direct table grants для `anon` и `authenticated` отсутствуют;
- клиент работает только через контролируемые RPC.

Public wrappers:

- `get_my_production_farm_risk_presets()`;
- `save_my_production_farm_risk_preset(...)`;
- `delete_my_production_farm_risk_preset(...)`.

Public wrappers — SECURITY INVOKER с пустым `search_path`.

Privileged table access находится в `risk_private` и проверяет:

- auth;
- non-partner staff context;
- current organization;
- current staff user;
- существующие Production Farm permissions.

Backend нормализует filters и отклоняет неизвестные ключи.

Ограничения:

- имя 1..60 символов;
- поиск до 120 символов;
- только 6 существующих risk categories;
- severity: CRITICAL / HIGH / MEDIUM / LOW;
- triage: mine / unassigned / ack;
- максимум 20 пресетов на сотрудника;
- одно default-представление на сотрудника в одной organization;
- имя уникально внутри organization + user без учёта регистра/пробелов по краям.

## Восстановление migration parity

Во время Phase 57 обнаружен drift:

- live Supabase уже содержал `production_farm_risk_presets` и RPC;
- в GitHub и migration history Phase 57 ещё не был зафиксирован.

В репозиторий добавлена полная идемпотентная migration:

`database/migrations/20260920_production_farm_risk_presets.sql`.

Она описывает фактический live schema contract и подходит для fresh/replay environments.

Так как production schema уже соответствовала этой migration, в production migration history безопасно зафиксирована проверка baseline:

- version: `20260920203649`;
- name: `production_farm_risk_presets`.

Никакие существующие production rows при этом не переписывались.

## Verification

### Lifecycle rollback

Проверено внутри `BEGIN ... ROLLBACK`:

1. создать preset A и сделать default;
2. создать preset B;
3. обновить B;
4. сделать B default;
5. удалить A;
6. прочитать персональный список.

Результат:

`phase57_risk_presets_ok`

Финальное состояние до rollback:

- presets = 1;
- default presets = 1;
- B filters = `q + PAYMENT_OBLIGATION + unassigned`.

### Tenant isolation rollback

Созданы временные presets для A4-Принт и 3D-ARTPRINT под разными staff context.

A4-Принт:

- видит свой preset;
- не видит preset 3D-ARTPRINT.

Результат:

`phase57_risk_presets_tenant_isolation_ok`.

### После rollback

- `production_farm_risk_presets` test residue = 0;
- Production Farm security baseline проходит;
- anon table grants = 0;
- anon public preset RPC EXECUTE = 0.

Supabase Security Advisor показывает для server-only preset table INFO `rls_enabled_no_policy`. Это ожидаемая модель этого слоя: RLS включён, direct client table grants закрыты, доступ идёт через permission-checked RPC. Phase 57 не добавляет anonymous SECURITY DEFINER endpoint.

## UI verification

Проверено:

- JavaScript syntax OK;
- три preset RPC подключены;
- все preset controls присутствуют;
- default preset защищён проверкой explicit URL filters;
- Phase 55 URL-state и Phase 56 server pagination сохранены;
- cache-bust: `20260920-phase57-1`.

## Scope

Phase 57 не меняет:

- расчёты владельцев;
- cash transactions;
- payment ledger;
- buyout;
- contracts;
- claims;
- partner responses;
- incidents;
- equipment status;
- risk assignment / ACK / NOTE semantics.

Это только персональный operational view layer поверх существующего Production Farm risk cockpit.
