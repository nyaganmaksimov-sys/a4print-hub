# Production Farm — Phase 31: расследование integrity-инцидентов

Phase 31 превращает события контроля Phase 30 в управляемую очередь расследований. Исходное событие нарушения не изменяется и не скрывается: все действия сотрудников записываются отдельной append-only историей.

## Состояния

- `OPEN` — событие обнаружено, действий ещё нет;
- `ACKNOWLEDGED` — принято ответственным сотрудником;
- `INVESTIGATING` — ведётся расследование/исправление;
- `RESOLVED` — нарушение устранено и закрыто с обязательным основанием;
- `REOPENED` — та же сигнатура нарушения снова обнаружена после закрытия.

`REOPENED` нельзя выставить вручную. Его создаёт только серверный integrity emitter, если ранее закрытая точная сигнатура снова становится активной.

## Append-only история

Таблица:

`equipment_claim_financial_integrity_actions`

хранит:

- ссылку на immutable Phase 30 event;
- тип действия;
- обязательную заметку;
- документ/ссылку-основание;
- сотрудника;
- время;
- монотонный `event_sequence`.

UPDATE и DELETE блокируются trigger guard с ошибкой:

`CLAIM_FINANCIAL_INTEGRITY_ACTION_APPEND_ONLY`.

Прямые client INSERT/UPDATE/DELETE закрыты. Для `authenticated` разрешён только SELECT по RLS для сотрудников с правами оборудования/расчётов.

## Серверные RPC

### list_equipment_claim_integrity_incidents(boolean)

Read-RPC строит очередь на основании immutable event + последнего append-only action + текущего результата Phase 30 checker.

Показывает:

- партнёра;
- договор;
- оборудование;
- исходные issue codes;
- текущее состояние кейса;
- последнее действие;
- текущее состояние integrity;
- текущие issue codes;
- активна ли исходная сигнатура.

RPC требует авторизацию и одно из прав:

- `equipment.view`;
- `equipment.contracts.manage`;
- `production.settlements.view`;
- `production.settlements.manage`.

### set_equipment_claim_integrity_incident_state(...)

Mutation-RPC разрешает сотруднику только:

- `ACKNOWLEDGED`;
- `INVESTIGATING`;
- `RESOLVED`.

Нужны права `equipment.contracts.manage` или `production.settlements.manage`.

Для любого действия обязательна заметка минимум 3 символа.

Для `RESOLVED` дополнительно обязательно основание минимум 2 символа.

Критическое правило: если точная сигнатура события всё ещё активна, `RESOLVED` блокируется с:

`INTEGRITY_ISSUE_STILL_ACTIVE`.

То есть закрыть проблему только административным статусом невозможно.

## Автоматическое повторное открытие

Phase 30 cron остаётся единственным ежедневным сканером:

- job: `equipment-claim-financial-integrity-daily`;
- schedule: `30 6 * * *`;
- 06:30 UTC.

Emitter использует детерминированную сигнатуру из issue codes, original/reversal/repost id и actual net effect.

Если событие с этой сигнатурой уже существует и его последнее действие — `RESOLVED`, emitter:

1. добавляет append-only action `REOPENED`;
2. создаёт новое WARNING для ответственных сотрудников;
3. не создаёт новый duplicate event.

Если нарушение остаётся активным и уже OPEN/ACKNOWLEDGED/INVESTIGATING/REOPENED, ежедневные дубли уведомлений не создаются.

## HUB UI

Добавлен экран:

`admin/equipment-claim-integrity-incidents.html`

и модуль:

`admin/equipment-claim-integrity-incidents.js`.

Экран показывает KPI и очередь OPEN/REOPENED/ACKNOWLEDGED/INVESTIGATING/RESOLVED, поиск и фильтры.

Из карточки доступны контролируемые действия:

- «Принять»;
- «В расследование»;
- «Закрыть»;
- «История».

Кнопка «Закрыть» отключена, пока текущий checker не показывает `OK`. Сервер всё равно повторно проверяет это условие.

При закрытии обязательны комментарий и документ/ссылка-основание.

Phase 30 dashboard получил прямой переход «Расследования». В основной навигации HUB добавлен пункт «Фин. нарушения».

Исправление самой финансовой цепочки остаётся в контролируемых процессах Phase 28/29. Phase 31 не редактирует деньги автоматически.

## Transaction lifecycle test

Тест выполнен в production внутри `BEGIN ... ROLLBACK` на полноценной временной цепочке contract → inspection → comparison → claim → cash transactions.

Сценарий:

1. Создан SETTLED claim на 100 RUB.
2. Original — `INCOME 100`.
3. Reversal намеренно также `INCOME 100`, поэтому checker обнаружил:
   - `REVERSAL_DIRECTION_MISMATCH`;
   - `NET_EFFECT_MISMATCH`.
4. Emitter создал integrity event.
5. RPC успешно записал `ACKNOWLEDGED`.
6. RPC успешно записал `INVESTIGATING`.
7. Попытка `RESOLVED` при активной сигнатуре заблокирована `INTEGRITY_ISSUE_STILL_ACTIVE`.
8. В тестовой транзакции направление reversal исправлено на `EXPENSE`; checker вернулся в `OK`.
9. `RESOLVED` успешно записан с основанием.
10. Ошибка намеренно возвращена.
11. Следующий emitter добавил `REOPENED` и снова уведомил.
12. Итоговая append-only последовательность:
    `ACKNOWLEDGED → INVESTIGATING → RESOLVED → REOPENED`.
13. UPDATE исторического action заблокирован append-only trigger.

Результат:

`phase31_integrity_incident_lifecycle_ok`.

После ROLLBACK тестовые события и действия отсутствуют.


## Tenant isolation hardening

После появления multi-company tenant RLS Phase 31 дополнительно ограничен организацией текущего сотрудника через `public.current_user_organization_id()`.

Защита действует на четырёх уровнях:

- RLS SELECT policy таблицы actions допускает только события оборудования текущей организации;
- `list_equipment_claim_integrity_incidents` фильтрует очередь по `equipment_assets.organization_id`;
- `set_equipment_claim_integrity_incident_state` сверяет организацию event и блокирует чужой event ошибкой `INTEGRITY_EVENT_NOT_AVAILABLE`;
- background emitter отправляет WARNING только активным сотрудникам организации конкретного оборудования.

При отсутствии organization context read/mutation RPC закрываются ошибкой `ORGANIZATION_CONTEXT_REQUIRED`.

### Tenant isolation test

В отдельном `BEGIN ... ROLLBACK` создан инцидент А4-Принт, после чего контекст переключён на действующего сотрудника 3D-ARTPRINT с теми же management permissions.

Проверено:

- чужой event отсутствует в `list_equipment_claim_integrity_incidents(true)`;
- mutation чужого event заблокирован `INTEGRITY_EVENT_NOT_AVAILABLE`;
- прямой SELECT actions под ролью `authenticated` возвращает 0 строк из-за RLS;
- сотрудник исходной организации видит event и action;
- уведомления по event не отправлены сотрудникам другой организации.

Результат:

`phase31_integrity_tenant_isolation_ok`.
