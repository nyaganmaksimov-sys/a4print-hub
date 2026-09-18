# Production Farm — Phase 41: security baseline and regression guard

Phase 41 фиксирует результат multi-company hardening Phase 33–40 как постоянный security baseline.

## Live baseline

Добавлены внутренние функции:

- `private.production_farm_security_baseline_violations()`;
- `private.assert_production_farm_security_baseline()`.

Обе недоступны `public`, `anon` и `authenticated`.

Baseline проверяет public SECURITY DEFINER функции, связанные с equipment/production.

### Проверки

`UNSAFE_SEARCH_PATH`

Любая equipment/production SECURITY DEFINER функция обязана иметь пустой `search_path`.

`ANON_SECURITY_DEFINER_EXECUTE`

Ни один такой privileged endpoint не должен быть исполняем ролью `anon`.

`INTERNAL_FUNCTION_CLIENT_EXECUTE`

Trigger/internal SECURITY DEFINER helpers не должны быть исполняемы `authenticated` напрямую.

`AUTH_RPC_WITHOUT_SCOPE_GUARD`

Authenticated SECURITY DEFINER RPC должен содержать один из признанных scope mechanisms:

- `private.assert_*`;
- `current_user_organization_id()`;
- `current_partner_id()`;
- payment/claim finance tenant helper.

Миграция завершается вызовом:

`private.assert_production_farm_security_baseline()`.

Если baseline нарушен, миграция падает fail-closed.

## Результат live audit

После Phase 33–40:

- equipment/production SECURITY DEFINER с unsafe search path: **0**;
- anon-executable privileged equipment/production RPC: **0**;
- authenticated RPC без распознаваемой tenant/partner scope-защиты: **0**;
- baseline violations: **0**.

Отдельно проверено, что ранее ложное срабатывание `set_equipment_contract_document_status` на самом деле защищено:

`private.assert_equipment_contract_document_tenant(p_document_id)`.

## PR regression guard

Добавлен скрипт:

`.github/scripts/check-production-farm-security-baseline.py`.

Он проверяет только SQL-файлы, изменённые в текущем PR, поэтому старые исторические миграции с уже superseded определениями не вызывают ложных ошибок.

CI блокирует:

- новое `search_path=public` в equipment/production SQL;
- новый `GRANT EXECUTE ... TO anon`;
- новую public equipment/production SECURITY DEFINER функцию без пустого search path;
- новую client-facing SECURITY DEFINER функцию без распознаваемого tenant/partner scope guard.

Internal/trigger functions допускаются без caller scope guard только когда они явно являются internal/trigger или в том же SQL закрыты через REVOKE от public/anon/authenticated.

## Supabase security model

Baseline следует текущей модели Supabase:

- exposed tables защищаются RLS;
- SECURITY DEFINER не полагается на RLS и поэтому требует отдельной проверки доступа;
- EXECUTE grants являются частью API boundary;
- privileged functions должны иметь безопасный search path.

## Следующий бизнес-этап

После Phase 41 security-hardening equipment/production считается закрытым на уровне baseline.

Следующий функциональный пробел Production Farm — контролируемое изменение состава оборудования активного договора. Phase 21 уже специально блокирует прямое изменение состава ошибкой:

`ACTIVE_CONTRACT_EQUIPMENT_CHANGE_REQUIRES_NEW_ANNEX`.

Следующая бизнес-фаза должна реализовать add/remove annex с актом, состоянием, комплектностью и evidence, не ослабляя эту блокировку.
