# Jarvis morning smoke test

After deploy:

1. Open any `/admin/*.html` page and confirm the Jarvis widget reports `Готов` instead of `Нет данных · Цех недоступен`.
2. Open Jarvis and type `открой клиентов`; confirm HUB navigates to customers.
3. Type `найди заказ 12`; confirm search returns an accessible order or a clear not-found response.
4. Click the wake button once. If microphone permission is not yet granted, approve it. Confirm the button reaches the listening state.
5. Say `Джарвис`; confirm the panel opens, Jarvis says `Слушаю`, and the next spoken phrase is accepted.
6. Say `Джарвис, открой заказы`; confirm direct navigation.
7. Toggle sound and confirm `Джарвис на связи` is audible.
8. In KASSA, open a shift and confirm the shift greeting is audible.
9. Verify Render logs show Jarvis `/health` heartbeat and no repeated Supabase auth `AbortError` burst.
