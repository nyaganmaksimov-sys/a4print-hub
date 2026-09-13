# Legacy cleanup — 2026-09-13

Подтверждённо удалённые или заменённые старые точки входа:

- standalone staff chat JS (`admin/messages.js`) — удалён ранее;
- standalone chat unread indicator (`admin/hub-chat-indicator.js`) — удалён ранее;
- отдельное Chat-приложение — удалено ранее;
- старые expenses implementations `admin/expenses.js` и `admin/expenses-v2.js` — удалены; канонический UI использует `admin/expenses-v3.js`;
- mobile navigation больше не проходит через legacy `admin/messages.html`; открывает встроенный `#hub-chat`;
- push navigation больше не направляет сообщения на legacy chat page;
- Mobile PWA и Support CI больше не требуют удалённые `chat-watchdog.js` / `chat-modern.js` и проверяют актуальный shared messenger.

Совместимые redirect-страницы `admin/messages.html` и `partner/crm-messages.html` пока остаются для старых закладок и внешних ссылок. Они не содержат старого интерфейса.

Файлы нельзя удалять только из-за суффикса `v2`, `v3`, `v4`: перед удалением обязательна проверка активных HTML/script/import/loader/service-worker ссылок.
