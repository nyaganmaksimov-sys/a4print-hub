# Production Farm — Phase 47: condition handoff для изменения состава оборудования

Phase 47 связывает юридический workflow изменения состава договора из Phase 42 с актами состояния Phase 23 и сверкой состояния Phase 24.

До Phase 47 подписанное `EQUIPMENT_COMPOSITION` ДС могло изменить состав договора, опираясь на condition/completeness/evidence внутри самого ДС, но без обязательного формального акта осмотра. Для REMOVE это позволяло обойти return comparison workflow.

## Новая связь

В `equipment_condition_inspections` добавлен:

`composition_amendment_asset_id`.

Он однозначно связывает один акт осмотра с одной ADD/REMOVE строкой:

`equipment_contract_amendment_assets.id`.

Для одной строки composition-ДС допускается только один связанный inspection.

## Подготовка осмотров

Staff RPC:

`prepare_equipment_composition_inspections(amendment_id)`.

Условия:

- только staff context;
- permission `equipment.manage` или `equipment.contracts.manage`;
- tenant договора совпадает с current organization;
- amendment kind = `EQUIPMENT_COMPOSITION`;
- amendment status = `APPROVED`.

Для каждой позиции:

- ADD → создаётся DRAFT `ACCEPTANCE`;
- REMOVE → создаётся DRAFT `RETURN`;
- inspected_on = amendment.effective_on;
- condition grade / operational state / meter hours копируются из подписываемой строки ДС;
- completeness из ДС переносится в checklist note;
- создаётся стандартный чек-лист visual / power / mechanics / safety / accessories.

Повторный вызов idempotent: существующий linked inspection не дублируется.

Если уже существует другой DRAFT того же типа по этому contract/equipment:

`COMPOSITION_INSPECTION_DRAFT_CONFLICT`.

## RETURN без расторжения

Обычный RETURN по-прежнему требует открытый termination:

`TERMINATION_REQUIRED_FOR_RETURN`.

Исключение существует только для inspection, который уже связан с REMOVE-строкой composition-ДС.

Для linked inspection нельзя менять:

- contract;
- equipment;
- inspection type;
- дату относительно effective_on;
- termination_id.

Таким образом исключение нельзя использовать как общий обход return workflow.

## Проверка факта против подписанного ДС

Перед переводом linked inspection в COMPLETED trigger проверяет:

- amendment всё ещё APPROVED;
- scope contract/partner/equipment совпадает;
- ADD использует ACCEPTANCE;
- REMOVE использует RETURN;
- termination_id отсутствует;
- inspected_on совпадает с amendment.effective_on;
- condition_grade совпадает со строкой ДС;
- operational_state совпадает со строкой ДС;
- meter_hours совпадает со строкой ДС.

Если фактический осмотр не соответствует подписанному ДС:

`COMPOSITION_INSPECTION_AMENDMENT_MISMATCH`.

Это намеренный fail-closed режим: нельзя подписать одно состояние, а затем применить договор с другим. Нужно оформить актуальный документ.

## Фото и документы

Phase 47 не ослабляет существующее Phase 23 правило:

- ACCEPTANCE требует минимум одну фотографию;
- RETURN требует минимум одну фотографию;
- COMPLETED inspection immutable.

После completion документ акта дополнительно связывается с:

- `EQUIPMENT_CONTRACT_AMENDMENT_ASSET`;
- `EQUIPMENT_CONTRACT_AMENDMENT`.

Metadata документа получает amendment id, amendment item id и ADD/REMOVE action.

Партнёр видит опубликованный завершённый акт через существующий раздел «Осмотры состояния».

## REMOVE и condition comparison

Завершённый composition RETURN использует тот же trigger Phase 24:

`create_equipment_condition_comparison_after_return()`.

То есть после RETURN автоматически строится сравнение с последней завершённой ACCEPTANCE.

Перед применением composition-ДС private readiness gate требует для REMOVE:

1. COMPLETED RETURN;
2. существующий condition comparison;
3. comparison status не `OPEN`.

Ошибки:

- `COMPOSITION_INSPECTION_REQUIRED`;
- `COMPOSITION_COMPARISON_REQUIRED`;
- `COMPOSITION_COMPARISON_RESOLUTION_REQUIRED`.

`NO_BASELINE` и `NO_DISCREPANCY` не блокируют применение.
`RESOLVED` также не блокирует.

Никакой ответственности или финансового требования Phase 47 автоматически не создаёт.

## ADD gate

ADD применяется только если существует COMPLETED ACCEPTANCE, привязанный к его amendment item.

Поэтому новый аппарат не может попасть в активный состав только на основании текста ДС без отдельного акта состояния и фотофиксации.

## Применение composition-ДС

`private.apply_equipment_contract_composition_amendment(uuid)` теперь до изменения period history вызывает:

`private.assert_equipment_composition_condition_ready(uuid)`.

Проверка выполняется после проверки подписи документа и до INSERT/UPDATE `equipment_contract_assets`.

То есть порядок:

`DRAFT → APPROVED → SIGNED → condition inspections → comparison/resolution if needed → APPLIED`.

## Отмена ДС

Если `EQUIPMENT_COMPOSITION` amendment переводится в CANCELLED, все его связанные DRAFT inspections автоматически переводятся в CANCELLED.

Completed inspections не удаляются и не переписываются.

Это не оставляет висячих рабочих черновиков после отмены юридического документа.

## Tenant isolation и notifications

`prepare_equipment_composition_inspections` использует contract tenant guard.

Cross-tenant попытка 3D-ARTPRINT подготовить осмотры A4-Принт amendment:

`EQUIPMENT_CONTRACT_NOT_AVAILABLE`.

При создании OPEN condition comparison notification теперь дополнительно ограничивается:

`organization_units.organization_id = equipment_assets.organization_id`.

То есть discrepancy A4-Принт не рассылается repair/admin пользователям другой организации.

Partner scope остаётся через `current_partner_id()`:

- Partner A видит свои completed composition inspections;
- Partner B те же inspection ids не видит.

## Admin UI

На странице «Допсоглашения по оборудованию» для APPROVED/APPLIED composition-ДС появляется:

**Осмотры состава**

Для APPROVED ДС кнопка:

1. вызывает `prepare_equipment_composition_inspections`;
2. открывает страницу осмотров с query parameter amendment id.

Страница «Осмотры состояния» при открытии из ДС:

- фильтрует список по amendment;
- показывает номер ДС и ADD/REMOVE;
- linked target/type/date нельзя менять;
- REMOVE по composition-ДС не требует fictitious termination.

Обычный ручной RETURN продолжает требовать termination.

## Partner UI

В разделе «Осмотры состояния» владелец видит:

- номер composition-ДС;
- «добавление» или «вывод»;
- состояние;
- чек-лист;
- дефекты;
- фото и файлы.

Показываются только COMPLETED inspections собственного partner.

## Production rollback test — lifecycle

Результат:

`phase47_composition_condition_handoff_ok`.

Сценарий:

1. создан временный A4 contract с equipment A;
2. для A создан baseline ACCEPTANCE: GOOD / READY / 10 h;
3. создан composition-ДС:
   - REMOVE A: FAIR / LIMITED / 20 h;
   - ADD B: GOOD / READY / 0 h;
4. ДС APPROVED и PAPER signed;
5. prepare RPC создал ADD ACCEPTANCE и REMOVE RETURN;
6. apply до completion заблокирован `COMPOSITION_INSPECTION_REQUIRED`;
7. ADD ACCEPTANCE завершён с photo;
8. REMOVE RETURN завершён с новым issue/defect и photo;
9. автоматически создан comparison: OPEN, material_change=true;
10. apply заблокирован `COMPOSITION_COMPARISON_RESOLUTION_REQUIRED`;
11. staff явно разрешил comparison как `NO_CLAIM`;
12. composition amendment успешно APPLIED;
13. old equipment period закрыт;
14. new equipment period открыт;
15. comparison document связан с amendment;
16. 3D-ARTPRINT prepare для A4 amendment заблокирован;
17. Partner A видит оба акта;
18. Partner B видит 0.

Все действия выполнены внутри `BEGIN ... ROLLBACK`.

## Production rollback test — cancellation cleanup

Результат:

`phase47_composition_inspection_cancel_cleanup_ok`.

Сценарий:

1. composition amendment APPROVED;
2. prepare RPC создал DRAFT inspection;
3. amendment отменён;
4. linked DRAFT inspection автоматически стал CANCELLED.

Тест также выполнен внутри `BEGIN ... ROLLBACK`.

## Rollback residue

После тестов:

- PH47 assets = 0;
- PH47 contracts = 0;
- PH47 amendments = 0;
- PH47 inspections = 0;
- PH47 comparisons = 0.

## Security

Live подтверждено:

- `private.production_farm_security_baseline_violations()` → 0 rows;
- public prepare RPC: SECURITY DEFINER + empty search path, anon=false, authenticated=true;
- public save inspection RPC: SECURITY DEFINER + empty search path, anon=false, authenticated=true;
- partner get_my RPC: SECURITY DEFINER + empty search path, anon=false, authenticated=true;
- staff list RPC остаётся SECURITY INVOKER;
- readiness/apply helpers: anon=false, authenticated=false;
- trigger helpers: anon=false, authenticated=false;
- existing Phase 23 photo/immutability protections сохранены.

Supabase Advisor не показывает anonymous exposure новых Phase 47 функций. Общепроектные старые advisor warnings остаются отдельным backlog.

## Следующий этап

После Phase 47 composition workflow замкнут юридически и технически:

`ДС → формальный акт состояния → сравнение → явное решение → изменение состава`.

Следующий аудит нужно направить на evidence integrity: generic evidence references внутри composition-ДС сейчас являются текстовыми/JSON ссылками, а фактические inspection photos хранятся отдельно в Storage. Следующая фаза может зафиксировать immutable evidence manifest/hash между подписанным amendment, inspection document и файлами, чтобы доказуемо связать документ с конкретными файлами.
