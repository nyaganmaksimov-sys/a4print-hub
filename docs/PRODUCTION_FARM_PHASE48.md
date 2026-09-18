# Production Farm — Phase 48: owner payment reconciliation

Phase 48 добавляет независимую сверку цепочки выплаты владельцу:

`obligation status → immutable ledger posting → cash transaction → reversal → audit document links`.

Phase 48 не создаёт, не сторнирует и не исправляет денежные операции автоматически. Он только обнаруживает расхождения и показывает их сотруднику/владельцу.

## Reconciliation view

Добавлен `public.equipment_owner_payment_reconciliation`.

View использует `security_invoker=true` и не доступен напрямую `anon` и `authenticated`.

Проверяются OWNER_SETTLEMENT и LEASE_CHARGE.

## Error codes

- `PAID_WITHOUT_ACTIVE_POSTING`
- `ACTIVE_POSTING_ENTITY_NOT_PAID`
- `LEDGER_ENTITY_MISMATCH`
- `ORIGINAL_TRANSACTION_MISSING`
- `ORIGINAL_TRANSACTION_MISMATCH`
- `REVERSAL_TRANSACTION_MISSING`
- `REVERSAL_TRANSACTION_MISMATCH`
- `REVERSED_POSTING_ENTITY_STILL_PAID`
- `PAYMENT_DOCUMENT_LINK_MISSING`
- `REVERSAL_DOCUMENT_LINK_MISSING`

Сверяются contract, partner, organization, amount, currency, cash account, direction, external_source/external_id и audit-document links.

## Staff RPC

`list_equipment_owner_payment_reconciliation(errors_only default true)`.

Требует auth, staff-context, current organization, `equipment.contracts.manage` и `production.settlements.manage`.

По умолчанию возвращает только ERROR rows текущей organization.

## Partner RPC

`get_my_equipment_owner_payment_reconciliation()`.

Возвращает только строки `current_partner_id()`.

Cash-account details, transaction ids и internal error codes владельцу не раскрываются.

## Admin UI

Добавлены:

- `admin/equipment-payment-reconciliation.html`
- `admin/equipment-payment-reconciliation.js`

В navigation: **Сверка выплат**.

Экран показывает KPI errors/OK/PAID/reversed и расшифровку каждого error code.

Из `Контроль выплат` добавлена ссылка на reconciliation.

## Partner UI

Добавлен `partner/equipment-owner-payment-reconciliation.js`.

Во вкладке «Начисления и выплаты» показывается блок **Сверка выплат**:

- СВЕРЕНО
- НА ПРОВЕРКЕ

## Production rollback test

Тест выполнен внутри `BEGIN ... ROLLBACK`.

Созданы временные LEASE contract и APPROVED lease charge с audit snapshot.

Через реальный Phase 47 RPC `post_equipment_owner_payment_financial_transaction(...)` создана выплата.

Валидная цепочка:

- integrity_status = OK
- error_codes = []

Затем trusted SQL изменил только original cash transaction amount с 1000 на 999.

Reconciliation немедленно вернул:

- integrity_status = ERROR
- `ORIGINAL_TRANSACTION_MISMATCH`

Partner A видит собственную ERROR row.

Partner B эту entity не видит.

Результат: `phase48_owner_payment_reconciliation_ok`.

После rollback:

- PH48 contracts = 0
- PH48 charges = 0
- PH48 cash rows = 0

## Security verification

Live подтверждено:

- Production Farm security baseline violations = 0
- view: `security_invoker=true`
- direct view SELECT: anon=false, authenticated=false
- staff RPC: SECURITY DEFINER + empty search path + organization scope
- partner RPC: SECURITY DEFINER + empty search path + partner scope
- оба RPC: anon=false, authenticated=true

## Следующий этап

Phase 49: persistent reconciliation incidents с first_seen / last_seen / occurrences, OPEN / ACKNOWLEDGED / RESOLVED, rescan и staff resolution. Автоматического исправления денег не будет.
