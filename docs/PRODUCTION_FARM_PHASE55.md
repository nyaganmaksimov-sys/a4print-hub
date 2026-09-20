# Production Farm — Phase 55: triage state и возврат из deep links

Phase 55 продолжает Phase 54 без новых доменных мутаций. Цель — сделать risk cockpit удобным для ежедневного triage и не терять рабочий контекст при переходе в профильный экран.

Phase 55 не меняет деньги, ledger, cash transactions, договорные статусы, claims, partner responses, статусы оборудования или risk actions автоматически.

## Triage filter

В `production-farm-risk.html` добавлен фильтр:

- Все назначения;
- Мои риски;
- Без ответственного;
- Принято в работу (ACK).

Фильтр работает поверх уже загруженного tenant-scoped cockpit payload.

### Мои риски

Для сравнения assignment используется внутренний staff user id, а не Auth UUID.

Cockpit получает его через существующий read-only RPC:

`get_my_staff_profile()`.

Используется:

`profile.data.user.id`

только если staff profile имеет статус `ACTIVE`.

Если профиль недоступен, фильтр fail-safe показывает 0 строк и информационное сообщение вместо попытки угадать identity.

## URL state

Cockpit сохраняет фильтры в query string через `history.replaceState`.

Поддерживаются:

- `q` — поиск;
- `category`;
- `severity`;
- `triage=mine|unassigned|ack`;
- `overdue=1`.

При открытии cockpit URL автоматически восстанавливает эти фильтры.

`popstate` также перечитывает фильтры из URL, поэтому browser back/forward не рассинхронизирует UI.

Значения валидируются allow-list'ами; неизвестная category/severity/triage игнорируется.

## Deep-link return state

При нажатии `Открыть →` cockpit добавляет в существующий domain deep link параметр:

`cockpit=<encoded cockpit query>`.

Identity самого риска остаётся прежней:

- PAYMENT_INTEGRITY → event;
- PAYMENT_OBLIGATION → entity_type + entity_id;
- CONTRACT_DEADLINE → contract;
- CONDITION_CLAIM → claim;
- PARTNER_DISPUTE → response;
- EQUIPMENT_INCIDENT → incident.

То есть Phase 55 не меняет способ поиска target entity и не расширяет доступ.

## Sanitized return link

`production-farm-deep-link.js` читает `cockpit` и строит кнопку:

`← К рискам Production Farm`.

Перед возвратом state пересобирается только из разрешённых ключей и значений:

- q ограничен 120 символами;
- category — одна из 6 risk categories;
- severity — CRITICAL/HIGH/MEDIUM/LOW;
- triage — mine/unassigned/ack;
- overdue — только 1.

Произвольный URL/redirect из параметра `cockpit` не используется.

Если `cockpit` отсутствует, поведение Phase 53 сохраняется: возврат идёт просто в `production-farm-risk.html`.

## Target screens

Phase 55 cache-bust'ит helper import и target scripts для всех шести маршрутов:

- equipment-payment-reconciliation / integrity incidents;
- equipment-payment-control;
- equipment-contract-deadlines;
- equipment-condition-claims;
- equipment-partner-responses;
- equipment incidents.

Target screens по-прежнему:

- показывают только данные, доступные существующему tenant/permission context;
- фокусируют точную entity из Phase 53;
- ничего не resolve/post/ACK автоматически;
- показывают return-link только при risk deep link.

## Исправление незавершённой ветки

Во время сборки Phase 55 найден и исправлен двойной query string в двух import:

`...?v=...phase55-1?v=...phase55-1`.

Финальный вариант использует один `?v=`.

Также добавлен пропущенный cache-bust для:

- `equipment-incidents.js` в `equipment.html`;
- `equipment-partner-responses.js` в `equipment-partner-responses.html`.

## Verification

Live проверено, что `get_my_staff_profile()` в A4 staff context возвращает ACTIVE profile с внутренним `user.id`, который соответствует типу assignment в cockpit.

Phase 55 не требует database migration и не меняет grants/RLS/SECURITY DEFINER функции.

Статический acceptance marker:

`phase55_risk_triage_state_ok`.

Browser acceptance contract:

1. открыть cockpit с несколькими фильтрами;
2. выбрать `Мои риски`, `Без ответственного` или `ACK`;
3. убедиться, что URL отражает state;
4. открыть конкретный риск;
5. target screen фокусирует нужную entity;
6. нажать `← К рискам Production Farm`;
7. убедиться, что исходные search/category/severity/triage/overdue восстановлены;
8. открыть target page без risk query params — обычное поведение не меняется.

## Security

Phase 55 не добавляет API endpoints.

- tenant isolation остаётся в существующих cockpit/target RPC;
- URL ids не дают дополнительного доступа;
- return state проходит allow-list sanitization;
- внешний redirect через cockpit state невозможен;
- ни одно действие риска не выполняется при навигации.
