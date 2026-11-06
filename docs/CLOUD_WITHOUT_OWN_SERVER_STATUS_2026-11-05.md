# A4PRINT Cloud staging — состояние на 5 ноября 2026

## Подключённые облачные сервисы

**Neon**: `A4PRINT-Cloud-STAGING`, project ID `curly-recipe-68200716`, branch `br-noisy-truth-b9cfuv02`, database `a4print_cloud`, PostgreSQL 17, Frankfurt.

- Neon Auth: включён (Better Auth), **без перенесённых сотрудников**.
- Neon Data API: активен, база пока пустая.
- Storage: приватные `order-files` и `marketplace-media` без клиентских файлов.
- Для Render создана **отдельная** Postgres-роль `a4print_cloud_probe` с правами `read_only` на `public`. Пароль хранится только в настройках среды Render.

**Render**: service `srv-dbm9n0g8v5cc73e0284g`, name `a4print-neon-cloud-api-staging`, region `frankfurt`, plan `free`, autoDeploy `no`.

- [Управление тестовым Render API](https://dashboard.render.com/web/srv-dbm9n0g8v5cc73e0284g)
- [Проверка здоровья](https://a4print-neon-cloud-api-staging.onrender.com/api/v1/cloud/health)
- Деплой Render `dep-dbm9n108v5cc73e0297g` (commit `f4b684b1b6085069d36918f61a91984f04ed1e1b`): **live**.
- Внешний тест GitHub Actions после запуска вернул `HTTP 200`, `checks.database=true`, `checks.neonAuthJwks=true`.
- `POST /api/v1/pos/sales` дал **HTTP 503 STAGING_ENDPOINT_DISABLED** (ожидаемо; API read-only).

Источник: [PR #391](https://github.com/nyaganmaksimov-sys/a4print-hub/pull/391), branch `integration/neon-cloud-staging-20261105`.

## Изоляция продакшена

Действующий сервис `a4print-hub-api` — **другой** Render service (id `srv-daa2v0e7bikc73f9kch0`), работает с Supabase на `main`. Он не изменялся.

DNS `api.a4print-hub.ru`, A4PRINT KASSA, HUB, 3D-ARTPRINT и ЦУИМ не перенаправлялись. МойСклад и кассовые чеки не отправлялись.

`/api/v1/mobile/auth/password`, POS/shift, orders, Supabase proxy и прочие боевые маршруты в новом тестовом сервисе **отключены**. Это **не готовый рабочий API** и не может принимать клиентов.

## Последовательность до реального облачного запуска

1. Сделать и проверить резервные копии Supabase SQL, `auth` и всех Storage buckets.
2. Перенести схему: таблицы, индексы, enum, триггеры, функции, расширения. Проверить различия Supabase и Neon.
3. Перенести и сверить данные **в тестовую среду**, включая связи по UUID. До переноса пользователей решить план безопасного восстановления авторизации, поскольку Supabase Auth и Neon Auth несовместимы напрямую.
4. Переписать RLS `auth.uid()` и JWT-права на Neon Auth. Закрыть сервисную роль от клиентского доступа.
5. Подключить файлы с проверкой ACL, приватных URL, загрузки G-code/STL и передачи в производство.
6. Заменить Supabase-зависимые серверные функции на эквиваленты; полностью восстановить API HUB и ЦУИМ.
7. Провести тестовые входы/сессии, кассовые операции, уникальность чеков, смены, возвраты и МойСклад без реальной фискализации.
8. Только после успешных тестов и плана отката — согласовывать переключение приложений и доменов.

## Контрольные ограничения

- Все изменения пока ограничены тестовой средой.
- Бесплатный Render может простаивать и запускаться медленнее; бесплатный Neon имеет квоты по трафику и вычислениям.
- Для рабочей кассы бесплатные облачные ресурсы не следует считать гарантией доступности.
- Не сохранять `DATABASE_URL`, токены Neon, ключи Supabase, пароли пользователей в GitHub или README.
