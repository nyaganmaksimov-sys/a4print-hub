# Production Farm — Phase 51: risk cockpit

Phase 51 собирает ключевые операционные риски Production Farm в один tenant-scoped экран.

## Что показывает cockpit

RPC:

`get_production_farm_risk_cockpit(limit_per_category default 12)`.

Категории:

- `PAYMENT_INTEGRITY` — открытые integrity incidents Phase 49/50;
- `PAYMENT_OBLIGATION` — невыплаченные owner settlements и lease/buyout charges;
- `CONTRACT_DEADLINE` — ACTIVE/SUSPENDED договоры, у которых осталось не более 30 дней;
- `CONDITION_CLAIM` — открытые требования по состоянию;
- `PARTNER_DISPUTE` — нерешённые DISPUTED-ответы владельцев;
- `EQUIPMENT_INCIDENT` — открытые неисправности и простои оборудования.

Summary содержит:

- total;
- critical / high / medium / low;
- overdue;
- unassigned integrity;
- payment integrity;
- payment obligations;
- contract deadlines;
- condition claims;
- claim disputes;
- partner disputes;
- equipment incidents;
- critical downtime.

Для каждого элемента возвращаются severity, state, overdue, due_at, сумма/валюта, заголовок, описание, href и category-specific meta.

## Единый risk source

Вместо двух дублирующихся UNION-блоков создан внутренний source:

`private.production_farm_risk_rows(organization_id)`.

Он недоступен public/anon/authenticated напрямую.

И summary, и список cockpit строятся из одного источника, поэтому категории и counts не могут расходиться из-за двух разных SQL-реализаций.

## Partner dispute provenance

До Phase 51 `equipment_partner_responses` не хранил contract/organization provenance.

Добавлены обязательные:

- `contract_id`;
- `organization_id`.

Старые строки при миграции backfill'ятся через связанную сущность:

- OWNER_SETTLEMENT;
- LEASE_CHARGE;
- CONTRACT_DOCUMENT → document_links → EQUIPMENT_CONTRACT.

Если строку нельзя однозначно привязать к договору/организации, миграция падает:

`PARTNER_RESPONSE_CONTRACT_CONTEXT_MISSING`.

## RLS исправление

Старая staff-policy `equipment_partner_responses_read` проверяла permission, но не organization.

Теперь staff SELECT разрешён только когда:

`response.organization_id = current_user_organization_id()`.

Partner context по-прежнему видит только собственный `partner_id`.

## list_equipment_partner_disputes

RPC переведён на SECURITY DEFINER + empty search path и теперь явно ограничивает:

- non-partner staff context;
- current organization;
- production.settlements.view/manage или equipment.contracts.manage.

В payload добавлены:

- contract_id;
- contract_number;
- organization_id.

## Notifications

`submit_equipment_partner_response(...)` теперь сохраняет contract/organization provenance в самой строке response.

DISPUTED notification отправляется только активным сотрудникам той же organization через `organization_units.organization_id`.

Раньше выбор recipients был глобальным по роли/permission.

## BUYOUT_EXTRA bugfix

Rollback test обнаружил старый дефект partner response RPC.

Для `LEASE_CHARGE` label строился через:

`period_start / period_end`.

У `BUYOUT_EXTRA` эти поля NULL, поэтому весь label становился NULL и RPC ошибочно возвращал:

`ENTITY_NOT_AVAILABLE`.

Теперь:

- LEASE → «Арендное начисление ... за DD.MM.YYYY–DD.MM.YYYY»;
- BUYOUT_EXTRA → «Доплата по выкупу по договору ...».

## Admin UI

Добавлены:

- `admin/production-farm-risk.html`;
- `admin/production-farm-risk.js`.

В navigation:

**Риски Production Farm**.

Экран содержит:

- KPI CRITICAL;
- KPI HIGH;
- KPI Просрочено;
- KPI Всего;
- counters по всем категориям;
- фильтр категории;
- фильтр severity;
- overdue-only;
- поиск;
- прямые ссылки в профильный рабочий экран.

`PARTNER_DISPUTE` отображается отдельной категорией и не смешивается с condition claims.

## Production rollback test

Тест выполнен внутри `BEGIN ... ROLLBACK`.

Созданы временные:

- A4-Принт LEASE_BUYOUT contract, ends_on = current_date + 5;
- BUYOUT_EXTRA charge 500 ₽;
- payment_due_date = current_date - 1;
- Partner A через реальный `submit_equipment_partner_response` отправил DISPUTED.

В A4 staff context cockpit подтвердил:

1. `CONTRACT_DEADLINE` по тестовому contract;
2. `PAYMENT_OBLIGATION` по charge и `overdue=true`;
3. `PARTNER_DISPUTE` по response;
4. summary.partner_disputes >= 1.

`list_equipment_partner_disputes(false)` вернул response с правильными contract_id и organization_id.

Direct RLS SELECT в A4 context видит response = 1.

Проверка notifications:

- recipients из другой organization = 0.

После переключения на 3D-ARTPRINT с теми же staff permissions:

- тестовые cockpit items = 0;
- тестовый dispute в list RPC = 0;
- direct RLS SELECT response = 0.

Результат:

`phase51_production_farm_risk_cockpit_ok`.

После rollback:

- PH51 contracts = 0;
- PH51 charges = 0;
- PH51 responses = 0.

## Security

Live подтверждено:

- `get_production_farm_risk_cockpit`: SECURITY DEFINER, empty search path, anon=false;
- `private.production_farm_risk_rows`: client execute=false;
- `list_equipment_partner_disputes`: organization-scoped;
- `submit_equipment_partner_response`: partner-scoped + org-scoped notifications;
- `private.assert_equipment_partner_response_tenant`: empty search path;
- Production Farm security baseline violations = 0.

Supabase Advisor не показал нового Phase 51-specific anonymous exposure.

## Next

Следующий логичный этап — Phase 52: actionable risk cockpit:

- acknowledge / assign directly from cockpit;
- deep links with entity id;
- owner-payment risk digest;
- SLA/age for disputes and equipment downtime;
- без автоматического изменения денег или юридических статусов.
