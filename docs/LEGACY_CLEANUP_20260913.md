# Legacy cleanup — 2026-09-13

Подтверждённо удалённые или заменённые старые точки входа:

- standalone staff chat JS (`admin/messages.js`) — удалён ранее;
- standalone chat unread indicator (`admin/hub-chat-indicator.js`) — удалён ранее;
- отдельное Chat-приложение — удалено ранее;
- исторические versioned-реализации расходов удалены; канонический UI использует `admin/expenses.js`;
- оборудование и расходники используют единый `admin/equipment-consumables.js`; старые `equipment-consumables-v2.js` и `equipment-consumables-units-fix.js` удалены;
- POS использует канонические `pos/app.js` и `pos/styles.css`; старые имена `app-v2.js` и `styles-v2.css` удалены;
- мобильная смена KASSA использует `kassa/shift-mobile.js` и `kassa/shift-mobile.css`; старые `shift-mobile-v2.js/css` удалены;
- устаревший `kassa/shift-live.js` удалён: актуальный экран смены и её summary обслуживаются `kassa/ui.js`, а backend live-status — `api/src/pos-shift-live-patch.js`;
- mobile navigation больше не проходит через legacy `admin/messages.html`; открывает встроенный `#hub-chat`;
- push navigation больше не направляет сообщения на legacy chat page;
- Mobile PWA и Support CI больше не требуют удалённые `chat-watchdog.js` / `chat-modern.js` и проверяют актуальный shared messenger.

Совместимые redirect-страницы `admin/messages.html` и `partner/crm-messages.html` пока остаются для старых закладок и внешних ссылок. Они не содержат старого интерфейса.

Файлы нельзя удалять только из-за суффикса `v2`, `v3`, `v4`, `fix`, `patch`, `fallback` или `legacy`: перед удалением обязательна проверка активных HTML/script/import/loader/service-worker ссылок и истории назначения файла.

SQL-миграции не переименовываются и не удаляются ради косметической уборки: их имена и порядок являются частью истории схемы базы данных.
