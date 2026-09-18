# Production Farm — Phase 42: изменение состава оборудования через допсоглашение

Phase 42 закрывает бизнес-пробел Phase 21: состав оборудования действующего договора теперь можно менять только через отдельное подписанное дополнительное соглашение.

Прямой путь по-прежнему блокируется:

`ACTIVE_CONTRACT_EQUIPMENT_CHANGE_REQUIRES_NEW_ANNEX`.

## Новый вид дополнительного соглашения

В `equipment_contract_amendments.amendment_kind` добавлен:

`EQUIPMENT_COMPOSITION`.

Он использует существующий юридический lifecycle Phase 21/22:

`DRAFT → APPROVED → SIGNED → APPLIED`.

То есть изменение состава не применяется при создании черновика или обычном подтверждении. Состав меняется только после существующего механизма подписи:

- подтверждение владельца в портале;
- бумажный экземпляр;
- внешняя электронная подпись.

Документ остаётся стандартным `EQ_CONTRACT_AMENDMENT` и хранится в общем архиве документов.

## Данные по каждой позиции

Для каждой ADD/REMOVE позиции фиксируются:

- оборудование;
- действие `ADD` / `REMOVE`;
- состояние: EXCELLENT / GOOD / FAIR / POOR / NON_OPERATIONAL;
- работоспособность: READY / LIMITED / NOT_OPERATIONAL;
- счётчик часов;
- комплектность;
- evidence;
- примечание;
- immutable snapshot оборудования на момент оформления;
- ссылка на фактический период `equipment_contract_assets` после применения ДС.

Таблица:

`equipment_contract_amendment_assets`.

Прямой доступ public/anon/authenticated к ней закрыт; запись выполняется только через controlled RPC.

## Создание ДС

RPC:

`create_equipment_composition_amendment(contract_id, effective_on, additions, removals, reason)`.

Проверки:

- только ACTIVE/SUSPENDED договор;
- tenant договора совпадает с текущей организацией;
- дата действия не в прошлом и внутри срока договора;
- минимум одна ADD/REMOVE позиция;
- один аппарат нельзя указать дважды или одновременно ADD+REMOVE;
- комплектность обязательна;
- evidence обязательно;
- оборудование должно принадлежать организации договора;
- списанное оборудование нельзя добавлять;
- REMOVE допустим только для оборудования, активного в договоре на дату ДС;
- ADD не может пересечь существующий период.

Cross-tenant попытка 3D-ARTPRINT создать ДС по договору А4-Принт блокируется:

`EQUIPMENT_CONTRACT_NOT_AVAILABLE`.

## История состава

До Phase 42 `equipment_contract_assets` имел:

`UNIQUE(contract_id, equipment_id)`.

Это не позволяло вывести аппарат и позднее повторно подключить его по тому же договору.

Phase 42 переводит связь на временные периоды:

- `starts_on` обязателен;
- `ends_on` закрывает период;
- `source_amendment_id` показывает, каким ДС оборудование добавлено;
- `ended_by_amendment_id` показывает, каким ДС оно выведено;
- повторное подключение создаёт новый период, старый не перезаписывается.

Перекрывающиеся периоды одного аппарата в одном договоре блокируются:

`EQUIPMENT_CONTRACT_PERIOD_OVERLAP`.

Перекрывающиеся периоды того же аппарата в разных договорах блокируются:

`EQUIPMENT_CONTRACT_PERIOD_CONFLICT`.

Последовательные исторические периоды разрешены.

## Прямой mutation guard

`guard_closed_equipment_contract_asset()` теперь защищает саму таблицу состава.

Для ACTIVE/SUSPENDED договора INSERT/UPDATE/DELETE разрешён только в трёх контролируемых контекстах:

- `app.equipment_contract_amendment_apply=1` — применение подписанного composition-ДС;
- `app.equipment_contract_initial_composition_save=1` — первичное сохранение состава через `save_equipment_contract`;
- `app.equipment_contract_termination_finalize=1` — закрытие текущих периодов при завершении расторжения.

Любая другая прямая попытка изменить активный состав получает:

`ACTIVE_CONTRACT_EQUIPMENT_CHANGE_REQUIRES_NEW_ANNEX`.

## Legal snapshot

`equipment_contract_legal_snapshot()` теперь включает `equipment_composition`.

Поэтому если состав договора изменился после создания черновика, старое ДС не применяется:

`CONTRACT_CHANGED_SINCE_DRAFT`

или, при изменении конкретной позиции в процессе:

`COMPOSITION_CHANGED_SINCE_DRAFT`.

Это защищает от применения устаревшего подписанного документа к уже другому составу.

## Применение

Общий RPC `apply_equipment_contract_amendment()` маршрутизирует `EQUIPMENT_COMPOSITION` во внутренний:

`private.apply_equipment_contract_composition_amendment()`.

REMOVE:

- находит период, активный на effective date;
- закрывает его `effective_on - 1`;
- сохраняет `ended_by_amendment_id`.

ADD:

- проверяет отсутствие пересечений;
- создаёт новый период с `starts_on=effective_on`;
- сохраняет `source_amendment_id`.

После этого:

- amendment → APPLIED;
- сохраняется after snapshot;
- signed document → ACTIVE;
- пишется история статуса документа.

## Исторический состав и расторжение

После появления истории старое поведение возврата стало бы неверным: система могла потребовать RETURN-инспекцию аппарата, который был выведен из договора раньше.

Phase 42 переводит termination flow на temporal scope:

`starts_on <= effective_end_date <= coalesce(ends_on, infinity)`.

На этот срез переведены:

- `get_equipment_contract_termination_condition_preflight()`;
- `guard_equipment_termination_return_inspections()`;
- `guard_equipment_termination_condition_comparisons()`;
- `finalize_equipment_contract_termination()`.

`get_equipment_condition_inspection_targets()` показывает только состав, активный на текущую дату.

При финализации расторжения закрываются только периоды, действующие на дату расторжения; исторические строки не изменяются.

## History-safe overview

`equipment_buyout_overview` считает `count(distinct equipment_id)`, поэтому повторное подключение аппарата не увеличивает количество оборудования.

`equipment_contract_termination_overview`:

- считает distinct оборудование;
- open jobs/open incidents рассматривает только по оборудованию, действующему на effective end date;
- остаётся `security_invoker=true`.

## Admin UI

В разделе «Допсоглашения по оборудованию» добавлена кнопка:

**+ Изменить состав**

Оператор может добавить несколько ADD/REMOVE строк в одно ДС.

Для каждой строки UI требует:

- оборудование;
- состояние;
- работоспособность;
- комплектность;
- evidence;
- при необходимости счётчик и примечание.

Обычные условия договора при этом не меняются.

## Partner Portal

Вкладка «Допсоглашения» показывает composition-ДС как:

- «Добавляется в договор»;
- «Выводится из договора».

В документе владелец видит:

- конкретный аппарат;
- состояние;
- комплектность;
- evidence;
- комментарий.

Согласование и подпись используют существующий Phase 22 workflow.

## Partner child tenant guard

Во время portal lifecycle test обнаружен старый конфликт между staff tenant guard и партнёрским доступом: `get_equipment_contract_amendment_document()` вызывал `private.assert_equipment_contract_child_tenant(...)`, который всегда переходил в staff organization guard.

Phase 42 исправляет helper fail-closed:

- staff по-прежнему проверяется через organization договора;
- partner определяется через `current_partner_id()`;
- partner допускается только к child entity договора, где `contract.partner_id=current_partner_id()`;
- чужой владелец получает `EQUIPMENT_CONTRACT_ENTITY_NOT_AVAILABLE`;
- helper имеет empty search path и недоступен public/anon/authenticated напрямую.

Это исправляет открытие документа ДС владельцем и одновременно сохраняет изоляцию Partner A / Partner B.

## Production rollback tests

### Composition lifecycle

Полный lifecycle прошёл:

`phase42_equipment_composition_annex_ok`.

Проверено:

1. прямое добавление аппарата в ACTIVE contract заблокировано;
2. создано ДС с REMOVE старого + ADD нового аппарата;
3. ДС утверждено;
4. записана PAPER signature;
5. ДС применено через общий apply RPC;
6. старый период закрыт;
7. новый период открыт;
8. completeness/evidence и обратная ссылка на period сохранены;
9. вторым ДС ранее выведенный аппарат повторно добавлен;
10. у него стало два исторических периода;
11. текущий состав корректно сохраняется обычным `save_equipment_contract`;
12. foreign tenant заблокирован.

### Termination temporal scope

Полный возврат/расторжение прошёл:

`phase42_temporal_termination_scope_ok`.

Сценарий:

- один аппарат был выведен вчера;
- один аппарат остаётся текущим;
- preflight насчитал только 1 текущий аппарат;
- RETURN inspection выполнена только по нему;
- comparison gate прошёл;
- termination успешно COMPLETED;
- исторический период не изменился;
- текущий период закрылся датой расторжения.

### Cross-contract periods

Проверка:

`phase42_cross_contract_period_guard_ok`.

- пересечение периода одного аппарата во втором договоре запрещено;
- следующий непересекающийся период разрешён.

Все тесты выполнялись внутри `BEGIN ... ROLLBACK`.

После rollback PH42 временные assets/contracts/amendments/change rows = 0.

## Security

После Phase 42:

- `private.production_farm_security_baseline_violations()` → 0 строк;
- новый public mutation RPC — SECURITY DEFINER + empty search_path;
- anon EXECUTE=false;
- contract tenant guard обязателен;
- private apply helper недоступен authenticated;
- amendment detail table закрыта от Data API mutation;
- history views используют `security_invoker=true`.

## Следующий этап

Отдельно остаётся temporal accounting для аренды: `equipment_owner_obligations` распределяет lease charge по периодам состава. При нескольких периодах одного аппарата внутри одного расчётного периода нужно исключить двойное участие в allocation.

Это логичный Phase 43.
