# Jarvis runtime recovery — 2026-09-11

This change fixes the morning failure mode where the Jarvis widget loaded but showed `Нет данных · Цех недоступен` and wake word did not react.

Changes:
- cache and deduplicate successful Supabase `/auth/v1/user` checks for Jarvis routes;
- retry transient auth-network failures and allow a short stale verified-session fallback;
- extend direct Jarvis upstream timeout so Render cold starts are not killed by the previous 15-second bridge timeout;
- keep the Jarvis service warm with a lightweight internal `/health` heartbeat;
- load `jarvis-wake.js` together with the assistant on every HUB admin page;
- make the wake toggle request microphone permission explicitly instead of accidentally disabling wake mode when it was enabled but not armed.

Safety:
- only previously verified auth responses can be served from cache;
- failed/invalid auth responses are never cached;
- stale verified-session fallback is limited to 15 minutes;
- non-idempotent Jarvis POST requests are not retried automatically.
