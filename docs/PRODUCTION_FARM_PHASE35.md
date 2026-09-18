# Production Farm — Phase 35: buyout / lease search-path hardening

Phase 35 закрывает legacy SECURITY DEFINER risk в lease/buyout контуре без изменения бизнес-логики.

## Что было

Следующие функции уже имели актуальный multi-company core tenant guard, но продолжали работать с `search_path=public`:

- `configure_equipment_lease_terms(...)`;
- `record_equipment_buyout_payment(...)`;
- `complete_equipment_buyout(...)`;
- внутренний trigger validator `validate_equipment_buyout_contract()`.

Для SECURITY DEFINER это лишняя поверхность риска: разрешение не fully-qualified объектов через writable search path может привести к подмене объекта.

## Что изменено

Для всех четырёх функций установлен пустой search path:

`search_path=''`.

Тела функций и business rules не переписывались.

Сохранены существующие core guards:

`private.assert_equipment_contract_tenant(p_contract_id)`

в трёх client-facing buyout RPC.

`equipment_buyout_overview` отдельно проверен и уже использует `security_invoker=true`; менять view не потребовалось.

## Production rollback test

Тест выполнен внутри `BEGIN ... ROLLBACK`.

В контексте А4-Принт:

1. создан временный `LEASE_BUYOUT` contract;
2. `configure_equipment_lease_terms` успешно сохранил lease/buyout параметры;
3. `record_equipment_buyout_payment` создал buyout payment;
4. charge переведён в APPROVED → PAID;
5. `complete_equipment_buyout` прошёл tenant/security envelope и дошёл до штатной бизнес-проверки `CONTRACT_HAS_NO_EQUIPMENT`.

Это подтверждает, что hardening search path не сломал рабочую бизнес-логику функции.

После переключения на 3D-ARTPRINT с теми же buyout permissions:

- configure чужого contract → `EQUIPMENT_CONTRACT_NOT_AVAILABLE`;
- record payment чужого contract → `EQUIPMENT_CONTRACT_NOT_AVAILABLE`;
- complete buyout чужого contract → `EQUIPMENT_CONTRACT_NOT_AVAILABLE`.

Результат:

`phase35_buyout_search_path_hardening_ok`.

После rollback:

`PH35-% contracts = 0`.

## Security verification

Live подтверждено:

- `configure_equipment_lease_terms`: SECURITY DEFINER, empty search path, anon=false, authenticated=true, core tenant guard=true;
- `record_equipment_buyout_payment`: SECURITY DEFINER, empty search path, anon=false, authenticated=true, core tenant guard=true;
- `complete_equipment_buyout`: SECURITY DEFINER, empty search path, anon=false, authenticated=true, core tenant guard=true;
- `validate_equipment_buyout_contract`: SECURITY DEFINER, empty search path, anon=false, authenticated=false.

Supabase security advisor всё ещё отмечает три authenticated SECURITY DEFINER mutation RPC как чувствительные endpoints. Это ожидаемо: они намеренно доступны authenticated staff, но внутри требуют `production.buyout.manage` и проходят core tenant guard. Anonymous exposure отсутствует.
