# Production Farm — Phase 53: actionable deep links

Phase 53 завершает переход из risk cockpit в профильные рабочие экраны. Deep link теперь не просто открывает страницу: целевой экран автоматически выбирает конкретный риск, подсвечивает его, переводит фокус к карточке и показывает возврат в cockpit.

Phase 53 не меняет деньги, проводки, договорные статусы, claims или статусы оборудования автоматически. Изменяется только навигация и presentation layer.

## Общий deep-link helper

Добавлен модуль:

`admin/production-farm-deep-link.js`.

Он централизует:

- чтение URL-параметров риска;
- кнопку `← К рискам Production Farm`;
- единый визуальный focus/highlight;
- scroll к целевой карточке;
- понятное сообщение, если риск уже закрыт, исчез или недоступен в текущем tenant context.

## PAYMENT_INTEGRITY

URL:

`equipment-payment-reconciliation.html?event=<event_id>`

Экран инцидентов сверки:

- фильтруется до `event_id`;
- карточка получает `data-risk-event`;
- целевая карточка подсвечивается и получает фокус;
- KPI продолжают считаться по полной доступной выборке;
- если инцидент уже закрыт/недоступен, пользователь видит сообщение вместо ложного совпадения.

## PAYMENT_OBLIGATION

URL:

`equipment-payment-control.html?entity_type=<type>&entity_id=<id>`

Экран:

- выбирает точное сочетание `entity_type + entity_id`;
- не подменяет тип обязательства;
- подсвечивает нужную строку;
- сохраняет существующие действия выплаты / ledger / срока.

## CONTRACT_DEADLINE

URL:

`equipment-contract-deadlines.html?contract=<contract_id>`

Экран:

- фильтруется по `contract_id`;
- показывает именно нужный договор;
- подсвечивает строку и переводит к ней фокус.

## CONDITION_CLAIM

URL:

`equipment-condition-claims.html?claim=<claim_id>`

Экран:

- выбирает exact `claim_id`;
- сохраняет обычные действия требования;
- подсвечивает карточку;
- не выполняет issue/resolve/financial posting автоматически.

## PARTNER_DISPUTE

URL:

`equipment-partner-responses.html?response=<response_id>`

Экран:

- выбирает exact partner response;
- подсвечивает спор;
- сохраняет ручное действие `Закрыть расхождение`;
- ничего не закрывает автоматически.

## EQUIPMENT_INCIDENT

URL:

`equipment.html?incident=<incident_id>`

Phase 53 автоматически:

1. открывает workspace `Инциденты и ремонты`;
2. фильтрует список до точного incident id;
3. подсвечивает карточку;
4. оставляет диагностику/ремонт/закрытие только ручными действиями пользователя.

## Return path

На любом из шести deep-link маршрутов в topbar появляется:

`← К рискам Production Farm`

Ссылка ведёт обратно в:

`production-farm-risk.html`.

При обычном открытии этих страниц без risk query params дополнительная кнопка не добавляется.

## Tenant/security model

Phase 53 не добавляет новых RPC, таблиц, grants, RLS policies или SECURITY DEFINER функций.

Target screens продолжают получать данные теми же tenant-scoped / permission-scoped механизмами, которые существовали до Phase 53. URL id сам по себе не расширяет доступ: если entity нет в доступной пользователю выборке, helper показывает «не найдено/недоступно» и не пытается запрашивать данные обходным способом.

## Cache busting

Обновлены версии target scripts в HTML, чтобы браузер не держал старую реализацию:

- payment integrity incidents;
- payment control;
- contract deadlines;
- condition claims;
- partner responses;
- equipment incidents.

## CI

Отдельный workflow:

`Check Production Farm Phase 53`

проверяет:

- синтаксис всех 7 JS файлов Phase 53;
- наличие всех 6 URL-параметров;
- наличие focus data markers;
- auto-open equipment incidents;
- return-link helper;
- cache-busting target scripts;
- отсутствие database migration в составе Phase 53.

## Verification contract

Статический acceptance marker:

`phase53_actionable_deep_links_ok`

Проверяемый сценарий для browser smoke:

1. открыть каждый href из live risk cockpit;
2. убедиться, что показывается ровно нужная entity;
3. убедиться, что карточка подсвечена и прокручена в viewport;
4. для equipment incident проверить автоматическое открытие окна инцидентов;
5. перейти по `← К рискам Production Farm`;
6. проверить обычное открытие target page без query params — поведение и список остаются прежними.
