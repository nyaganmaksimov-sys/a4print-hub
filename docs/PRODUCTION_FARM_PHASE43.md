# Production Farm — Phase 43: temporal lease allocation

Phase 43 делает арендные обязательства history-safe после появления периодов состава договора в Phase 42.

## Найденная ошибка

До Phase 43 `equipment_owner_obligations` распределял сумму lease charge непосредственно по строкам `equipment_contract_assets`.

После Phase 42 один аппарат может иметь несколько исторических периодов в одном договоре. Если два периода одного аппарата пересекали расчётный месяц, аппарат учитывался дважды.

Контрольный пример:

- charge: 1 000 ₽;
- аппарат A активен 20 из 30 дней, но двумя отдельными периодами;
- аппарат B активен все 30 дней;
- allocation_weight обоих = 1.

Старый view дал:

- A: **666,67 ₽**;
- B: **333,33 ₽**.

То есть он посчитал три строки периода, а не фактическое участие оборудования.

## Новая temporal formula

Добавлен audit-view:

`public.equipment_lease_charge_allocations`.

Сначала для каждой строки периода определяется пересечение:

- `active_from = max(charge.period_start, asset_period.starts_on)`;
- `active_to = min(charge.period_end, asset_period.ends_on)`;
- `active_days = active_to - active_from + 1`.

Затем все периоды одного `charge_id + equipment_id` агрегируются.

Вес оборудования:

`effective_weight = Σ(active_days × allocation_weight)`.

Доля:

`allocation_ratio = effective_weight / Σ effective_weight по charge`.

Сумма:

`allocated_amount = charge.amount × allocation_ratio`.

Тем же ratio распределяется `buyout_credit_amount`.

Это означает:

- повторное подключение одного аппарата не создаёт двойную долю;
- неполный расчётный период учитывается пропорционально активным дням;
- изменение `allocation_weight` между периодами учитывается корректно;
- сумма allocations сохраняет сумму исходного charge.

## Audit columns

View отдаёт:

- charge / contract / organization / partner;
- period_start / period_end;
- equipment_id;
- first_active_on / last_active_on;
- active_days;
- period_count;
- effective_weight;
- total_effective_weight;
- asset_count;
- allocation_ratio;
- allocated_amount;
- allocated_buyout_credit_amount.

Это позволяет разбирать каждый расчёт без ручного восстановления истории договора.

## Owner obligations

`equipment_owner_obligations` больше не распределяет charge самостоятельно.

Lease-часть агрегируется из `equipment_lease_charge_allocations`:

- APPROVED → `approved_lease_due`;
- PAID → `paid_lease_amount`.

Revenue-share settlement logic не менялся.

## Partner context isolation

Во время RLS-теста обнаружено, что один из partner accounts одновременно имеет staff permissions.

Обычные RLS policies объединяются через OR, поэтому staff-policy мог позволить такому partner-context увидеть чужой contract/charge.

Phase 43 не ломает staff policies глобально. Вместо этого оба финансовых view имеют explicit context scope:

`current_partner_id() is null OR row.partner_id=current_partner_id()`.

Для `equipment_owner_obligations` финальный equipment set также ограничивается текущим владельцем/договорами этого партнёра.

Итог:

- обычный staff context без partner mapping работает как раньше;
- partner context всегда ограничен своим partner_id, даже при наличии staff permissions;
- Partner B не видит allocations/obligations Partner A.

Оба view используют `security_invoker=true`.

## Production rollback tests

### Arithmetic

До исправления контрольный сценарий воспроизвёл ошибку:

- A = 666,67 ₽;
- B = 333,33 ₽.

После Phase 43:

- A: 20 active days / 2 periods → **400 ₽**;
- B: 30 active days / 1 period → **600 ₽**;
- sum allocated_amount = **1 000 ₽**;
- buyout credit 100 ₽ распределился с общей суммой **100 ₽**;
- после перевода charge в PAID paid allocation остался 400/600.

Результат:

`phase43_temporal_lease_allocation_ok`.

### Partner scope

Partner A видит свои allocation rows.

Partner B для того же charge/equipment получает:

- allocation rows = 0;
- obligation rows = 0.

Результат:

`phase43_lease_allocation_partner_scope_ok`.

Все тесты выполнены внутри `BEGIN ... ROLLBACK`.

После rollback:

- PH43 assets = 0;
- PH43 contracts = 0;
- PH43 charges = 0.

## Security

Live подтверждено:

- Production Farm security baseline violations = 0;
- `equipment_lease_charge_allocations`: `security_invoker=true`;
- `equipment_owner_obligations`: `security_invoker=true`;
- anon SELECT нового view = false;
- authenticated SELECT = true и ограничивается underlying RLS + explicit partner context.

## Следующий этап

Следующий логичный шаг — использовать allocation audit в рабочем интерфейсе расчётов: показывать сотруднику и владельцу, из каких active days / weights сложилась сумма по каждому аппарату, и добавить проверяемый snapshot allocation в финансовый документ.

Это Phase 44.
