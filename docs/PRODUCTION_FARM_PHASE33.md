# Production Farm — Phase 33: tenant guards для финансового lifecycle требований

Phase 33 закрывает write/read риск Phase 27–29 после перехода A4PRINT HUB на multi-company.

До hardening финансовые RPC проверяли permissions и организацию cash account относительно equipment, но SECURITY DEFINER функции не сверяли организацию текущего сотрудника с организацией claim. Сотрудник другого tenant с теми же manage-permissions теоретически мог обратиться к чужому claim_id.

## Tenant root

Добавлен внутренний helper:

`equipment_condition_claim_financial_tenant_org(uuid)`

Он проверяет цепочку:

`condition claim → equipment contract.organization_id → equipment asset.organization_id → current_user_organization_id()`.

Правила:

- claim отсутствует → `CLAIM_NOT_FOUND`;
- contract/asset без organization → `CLAIM_FINANCIAL_ORGANIZATION_REQUIRED`;
- contract и asset принадлежат разным организациям → `CLAIM_FINANCIAL_TENANT_MISMATCH`;
- отсутствует tenant context → `ORGANIZATION_CONTEXT_REQUIRED`;
- claim принадлежит другой организации → `CLAIM_NOT_AVAILABLE`.

Helper — SECURITY DEFINER с `set search_path=''`, но EXECUTE закрыт для `public`, `anon` и `authenticated`.

## Hardened write/options RPC

Tenant guard выполняется до чтения финансового состояния claim в:

- `get_equipment_condition_claim_financial_options(uuid)`;
- `post_equipment_condition_claim_financial_transaction(...)`;
- `reverse_equipment_condition_claim_financial_transaction(...)`;
- `get_equipment_condition_claim_financial_repost_options(uuid)`;
- `repost_equipment_condition_claim_financial_transaction(...)`.

Это важно: чужой caller не получает различий между состояниями «проводка уже есть», «сторно уже есть», «repost уже есть» — сначала отрабатывает `CLAIM_NOT_AVAILABLE`.

Дополнительно original/reversal/repost cash transactions сверяются с tenant organization. Несогласованная финансовая цепочка блокируется `CLAIM_FINANCIAL_TRANSACTION_TENANT_MISMATCH`.

## Staff financial lists

Следующие RPC работают как контролируемые SECURITY DEFINER read-RPC с обязательными auth/permission/tenant checks:

- `list_equipment_condition_claim_financial_postings()`;
- `list_equipment_condition_claim_financial_reversals()`;
- `list_equipment_condition_claim_financial_reposts()`.

Каждый список фильтрует contract organization, equipment organization, cash transaction organization и cash account organization по `current_user_organization_id()`.

Reversal/repost list-RPC ранее были переведены в SECURITY INVOKER, но это конфликтовало с более строгим tenant RLS `cash_transactions`, где SELECT доступен только ADMIN. Phase 33 возвращает безопасный SECURITY DEFINER с явным tenant-фильтром, сохраняя intended permissions для equipment/settlements staff.

## Direct RLS

Policy:

- `equipment_condition_claim_financial_reversals_staff_read`;
- `equipment_condition_claim_financial_reposts_staff_read`

теперь требует не только permission, но и совпадение организации current user с contract и equipment claim.

Прямые INSERT/UPDATE/DELETE для authenticated по этим audit-таблицам по-прежнему закрыты. Append-only guards Phase 28/29 не менялись.

## Production lifecycle test

Тест выполнен внутри `BEGIN ... ROLLBACK`.

Для временного claim А4-Принт выполнена штатная цепочка:

1. `get_equipment_condition_claim_financial_options`;
2. posting 100 RUB;
3. reversal;
4. `get_equipment_condition_claim_financial_repost_options`;
5. corrected repost;
6. staff lists postings/reversals/reposts — по 1 строке;
7. все три cash transactions принадлежат A4-Принт.

Затем auth context переключён на действующего сотрудника 3D-ARTPRINT с теми же `equipment.contracts.manage` и `production.settlements.manage`.

Проверено:

- foreign financial options → `CLAIM_NOT_AVAILABLE`;
- foreign posting → `CLAIM_NOT_AVAILABLE`;
- foreign reversal → `CLAIM_NOT_AVAILABLE`;
- foreign repost options → `CLAIM_NOT_AVAILABLE`;
- foreign repost → `CLAIM_NOT_AVAILABLE`;
- staff postings list по A4 claim → 0;
- staff reversals list по A4 claim → 0;
- staff reposts list по A4 claim → 0;
- direct RLS SELECT reversal → 0;
- direct RLS SELECT repost → 0.

Результат:

`phase33_claim_finance_tenant_guards_ok`.

После rollback:

- test reversal rows = 0;
- test repost rows = 0;
- test cash rows = 0.

## Security

- client-facing staff RPC: `anon EXECUTE=false`, `authenticated EXECUTE=true`;
- internal tenant helper: `anon=false`, `authenticated=false`;
- SECURITY DEFINER functions use `set search_path=''`;
- partner `get_my_*` RPC не менялись: их изоляция остаётся через `current_partner_id()`;
- Phase 33 не создаёт финансовые операции автоматически и не меняет business rules сумм/направлений, только tenant enforcement.
