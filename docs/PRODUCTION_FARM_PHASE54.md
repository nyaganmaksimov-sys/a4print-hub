# Production Farm — Phase 54: risk action timeline / notes

Phase 54 закрывает операционный разрыв в actionable risk cockpit: backend уже сохранял append-only действия и поддерживал `NOTE`, но UI не позволял добавить отдельную заметку и не показывал историю работы с риском.

Phase 54 не меняет деньги, ledger, cash transactions, договорные статусы, claims, partner responses или статусы оборудования автоматически.

## Что добавлено

В cockpit для каждого активного риска:

- управляющие роли: `Назначить`, `ACK`, `Заметка`, `История`, `Открыть`;
- read-only staff: `История`, `Открыть`;
- последняя заметка по-прежнему видна прямо в карточке;
- полная cockpit timeline открывается в отдельном dialog.

## NOTE

Кнопка `Заметка` использует существующий Phase 52 RPC:

`apply_production_farm_risk_action(..., 'NOTE', ..., note)`.

NOTE:

- требует активный риск;
- требует управляющие права Production Farm;
- не меняет assignment;
- не меняет ACK;
- не меняет доменный объект риска;
- добавляет append-only запись в `production_farm_risk_actions`;
- обновляет `last_note` для обычных work items.

## History RPC

Добавлен публичный Data API wrapper:

`get_production_farm_risk_action_history(category, entity_id, limit default 50)`.

После security hardening финальная схема такая:

- `public.get_production_farm_risk_action_history(...)` — `SECURITY INVOKER`;
- privileged table read находится в `risk_private.get_production_farm_risk_action_history(...)`;
- `risk_private` не является публичным API schema;
- browser role получает только USAGE schema + EXECUTE конкретного private reader;
- direct SELECT таблицы не выдаётся.

RPC:

- требует auth;
- запрещает partner context;
- берёт organization только из текущего staff context;
- разрешает просмотр тем же read permissions, что risk cockpit;
- принимает только 6 известных risk categories;
- ограничивает limit диапазоном 1..100;
- фильтрует строго по `organization_id + category + entity_id`;
- возвращает newest-first action timeline;
- direct SELECT таблицы журнала browser roles по-прежнему не получают.

Каждое событие содержит:

- `ASSIGNED` / `ACKNOWLEDGED` / `NOTE`;
- comment/note;
- event sequence;
- timestamp;
- actor;
- назначенного сотрудника для ASSIGNED.

Имена actor/assignee возвращаются только если пользователь сейчас относится к той же organization.

## Tenant isolation

Live rollback verification проверил две организации A4 ↔ 3D:

- A4 получает собственную тестовую timeline;
- A4 получает 0 событий для entity 3D;
- 3D получает собственную timeline;
- 3D получает 0 событий для entity A4;
- actor name возвращается только в своей organization;
- после rollback тестовых action rows = 0.

Результаты:

`phase54_risk_action_timeline_ok`

после hardening:

`phase54_risk_action_timeline_hardened_ok`

## Privileges

Live после migration:

- `anon` EXECUTE history RPC = false;
- `authenticated` EXECUTE history RPC = true;
- `anon` direct SELECT `production_farm_risk_actions` = false;
- `authenticated` direct SELECT `production_farm_risk_actions` = false;
- RLS существующего append-only журнала остаётся включён;
- UPDATE/DELETE journal по-прежнему блокируются Phase 52 trigger;
- public history wrapper: SECURITY DEFINER = false;
- private reader: SECURITY DEFINER = true + empty search_path;
- Production Farm security baseline violations = 0;
- Supabase Security Advisor: новых findings для timeline RPC = 0.

## UI timeline

Dialog показывает:

- тип действия;
- точное время;
- автора;
- назначенного сотрудника;
- комментарий;
- общее количество событий;
- максимум последние 50 событий в текущем UI.

История загружается только по нажатию, поэтому основной cockpit не делает N дополнительных RPC на каждую карточку.

## Live NOTE smoke limitation

На момент Phase 54 в обеих production organizations не было активных actionable risks, поэтому безопасный rollback smoke реального `NOTE` через `apply_production_farm_risk_action` не мог выбрать существующую активную entity без искусственного создания доменного риска.

Сам NOTE path не изменялся: это существующий и уже проверенный Phase 52 workflow. Phase 54 проверяет новый history RPC с двумя tenant-isolated rollback rows и статически проверяет UI вызов `p_action: 'NOTE'`.

## Verification

- обе live migrations applied;
- rollback tenant test: `phase54_risk_action_timeline_ok`;
- hardened rollback tenant test: `phase54_risk_action_timeline_hardened_ok`;
- test rows after rollback: 0;
- history table remains unavailable for direct browser SELECT;
- UI JavaScript syntax проверяется отдельным CI;
- migration security markers проверяются отдельным CI.

## Next

Следующий логичный этап после timeline — не добавлять новые мутации, а улучшить triage: фильтр `Мои риски / Без ответственного / ACK`, сохранение состояния cockpit в URL и возврат из deep link обратно с тем же фильтром.
