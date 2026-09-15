# Production Farm Phase 25 — termination condition gate

Phase 25 связывает контролируемое расторжение договора с результатами возвратного осмотра и Phase 24-сверкой состояния оборудования.

## Задача

Договор нельзя окончательно закрыть, если возврат оборудования физически не подтверждён или по возврату обнаружено материальное расхождение состояния, которое ещё не рассмотрено HUB.

При этом Phase 25 **не назначает виновного**, **не создаёт долг**, **не создаёт платёж, удержание, штраф или начисление**. Ответственность и любые финансовые последствия остаются отдельным явным решением сотрудников и сторон.

## Серверная защита

Миграция: `database/migrations/20260915_production_farm_termination_condition_gate.sql`.

Добавлены три уровня защиты:

1. `get_equipment_contract_termination_condition_preflight(uuid)` — безопасный staff RPC для проверки перед финализацией. Возвращает:
   - количество оборудования договора;
   - количество завершённых возвратных осмотров по текущему расторжению;
   - оборудование без завершённого `RETURN`-осмотра;
   - оборудование, по которому не сформирована Phase 24-сверка;
   - `OPEN`-сверки состояния и связанные единицы оборудования;
   - `condition_gate_clear` и `can_finalize_condition`.
2. `finalize_equipment_contract_termination(...)` выполняет ранние проверки **до любых изменений**:
   - `RETURN_INSPECTION_REQUIRED:<count>`;
   - `CONDITION_COMPARISON_REQUIRED:<count>`;
   - `CONDITION_COMPARISON_RESOLUTION_REQUIRED:<count>`.
3. `guard_equipment_termination_condition_comparisons()` + trigger `trg_guard_equipment_termination_condition_comparisons` остаётся последней транзакционной защитой при переводе процедуры в `COMPLETED`, даже если финализацию попытаются выполнить не через штатный UI.

Существующий Phase 23 trigger `trg_guard_equipment_termination_return_inspections` сохранён и продолжает отдельно контролировать наличие возвратного осмотра по каждой единице оборудования.

## Какие состояния блокируют расторжение

Финализацию блокирует только реально незавершённый контур возврата:

- отсутствует завершённый `RETURN`-осмотр;
- завершённый возврат есть, но по нему нет Phase 24-сверки;
- сверка имеет `comparison_status='OPEN'`.

`NO_DISCREPANCY`, `NO_BASELINE` и `RESOLVED` сами по себе финализацию не блокируют.

## Интерфейс HUB

`admin/equipment-contract-termination.js` перед открытием финального действия вызывает `get_equipment_contract_termination_condition_preflight` и показывает отдельные причины блокировки:

- недостающие возвратные осмотры — со ссылкой на «Осмотры состояния»;
- несформированные сверки;
- открытые материальные расхождения — со ссылкой на «Сверку состояния».

Кнопка финального закрытия недоступна, пока preflight не пройден. Серверная проверка остаётся обязательной независимо от состояния кнопки в браузере.

## Security

- RPC использует `SECURITY DEFINER` и `set search_path=''`.
- Для вызова требуется авторизация и `equipment.contracts.manage`.
- `anon` EXECUTE отсутствует.
- Trigger-функция не выдаётся browser roles на EXECUTE.
- Партнёр не получает новый RPC для изменения статуса расторжения или результата сверки.

## Production test

Проведён транзакционный тест в production-схеме с `BEGIN ... ROLLBACK`:

1. создан временный договор, оборудование и процедура расторжения;
2. добавлен завершённый возвратный осмотр;
3. создана материальная Phase 24-сверка со статусом `OPEN`;
4. preflight вернул `open_condition_comparisons_count = 1`;
5. `finalize_equipment_contract_termination` был заблокирован ошибкой `CONDITION_COMPARISON_RESOLUTION_REQUIRED`;
6. после отказа подтверждено отсутствие частичных изменений договора, оборудования и процедуры;
7. сверка вручную закрыта через `resolve_equipment_condition_comparison(..., 'NO_CLAIM', ...)`;
8. повторный preflight стал чистым;
9. финализация успешно перевела договор в `TERMINATED`, процедуру в `COMPLETED`, оборудование — в `OFFLINE`;
10. вся тестовая транзакция выполнена с `ROLLBACK`.

Результат: `phase25_termination_condition_gate_ok`.
