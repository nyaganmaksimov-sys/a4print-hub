# Production Farm — Phase 32: tenant scope для финансового integrity-контроля

Phase 32 закрывает multi-company риск в Phase 30 после включения tenant RLS в A4PRINT HUB.

До hardening Phase 30 проверял права сотрудника, но его SECURITY DEFINER read-RPC и SELECT policy integrity-events не ограничивали данные организацией. Сотрудник другой организации с теми же permissions теоретически мог получить чужие integrity-данные.

## Что изменено

### Integrity events RLS

Policy `equipment_condition_claim_financial_integrity_events_staff_read` теперь требует одновременно:

- одно из прав просмотра/управления оборудованием или расчётами;
- принадлежность оборудования события текущей организации сотрудника.

Организация определяется только серверным helper:

`public.current_user_organization_id()`.

Связь проверяется через:

`event → condition claim → equipment asset → organization_id`.

Прямые INSERT/UPDATE/DELETE для authenticated по-прежнему закрыты.

### Phase 30 read-RPC

`get_equipment_condition_claim_financial_integrity(boolean)` теперь:

1. требует `auth.uid()`;
2. проверяет прежние permissions;
3. получает `v_org := public.current_user_organization_id()`;
4. fail-closed выдаёт `ORGANIZATION_CONTEXT_REQUIRED`, если tenant не определён;
5. фильтрует rows по `equipment_assets.organization_id = v_org`;
6. считает summary KPI только по текущей организации.

Таким образом и список, и агрегаты Phase 30 больше не могут смешивать данные разных компаний.

## Что не изменено

Внутренний checker `equipment_condition_claim_financial_integrity_rows()` остаётся серверным глобальным read model. Он не доступен `anon` или `authenticated` напрямую и нужен cron/emitter для глобального серверного контроля.

Background emitter уже был tenant-hardened в Phase 31: уведомления направляются только сотрудникам организации оборудования.

## Transaction test

Тест выполнен внутри `BEGIN ... ROLLBACK`.

Создан временный ошибочный integrity-event для оборудования А4-Принт.

Контекст А4-Принт:

- Phase 30 RPC видит тестовый claim — 1 строка;
- прямой SELECT integrity-events под ролью `authenticated` видит event — 1 строка.

Контекст 3D-ARTPRINT с теми же equipment/contracts/settlements permissions:

- Phase 30 RPC не видит A4 claim — 0 строк;
- прямой SELECT integrity-events под ролью `authenticated` не видит A4 event — 0 строк.

Результат:

`phase32_integrity_tenant_scope_ok`.

После rollback тестовые данные отсутствуют.

## Security model

- read-RPC: `anon=false`, `authenticated=true`;
- SECURITY DEFINER использует `set search_path=''`;
- event table RLS включён;
- direct authenticated write privileges отсутствуют;
- отсутствие tenant context закрывает доступ, а не расширяет его.
