# Production Farm Phase 19 — сроки договоров оборудования

Phase 19 контролирует приближение и наступление даты окончания договоров партнёрского оборудования. Система **не продлевает и не расторгает договор автоматически**: юридическое действие остаётся отдельным управляемым процессом Phase 14.

## Состояния

- `OPEN_ENDED` — дата окончания не задана;
- `ACTIVE` — до окончания больше 30 дней;
- `ENDS_30` — до 30 дней;
- `ENDS_14` — до 14 дней;
- `ENDS_7` — до 7 дней;
- `ENDS_TODAY` — договор заканчивается сегодня;
- `EXPIRED` — дата окончания прошла, а договор всё ещё ACTIVE/SUSPENDED;
- `CLOSED` — договор уже TERMINATED/COMPLETED.

## Автоматические уведомления

`emit_equipment_contract_deadline_notifications()` ежедневно вызывается `pg_cron` задачей `equipment-contract-deadlines-daily` в 06:15 UTC. Напоминания фиксируются в append-only таблице `equipment_contract_deadline_events` и дедуплицируются по `contract_id + ends_on + notice_kind`.

Ступени: `D30`, `D14`, `D7`, `D1`, `D0`, `EXPIRED`. Получатели — ADMIN и сотрудники с `equipment.contracts.manage`.

Фоновая функция не имеет `EXECUTE` для `anon` или `authenticated`.

## Партнёрский кабинет

В `partner/equipment.html` добавлена вкладка **«Сроки договоров»**. RPC `get_my_equipment_contract_deadlines()` получает `partner_id` только через `current_partner_id()` и возвращает исключительно договоры текущего владельца.

## HUB

Страница `admin/equipment-contract-deadlines.html` показывает KPI, поиск и фильтрацию по срокам. RPC `list_equipment_contract_deadlines()` требует `equipment.view` или `equipment.contracts.manage`.

## Проверка

Рабочая Supabase проверена транзакционным тестом с `ROLLBACK`: два партнёра увидели только свои договоры, договор с окончанием через 7 дней получил `ENDS_7`, первый запуск уведомлений создал событие, повторный запуск не создал дубль. Результат: `phase19_contract_deadlines_ok`.
