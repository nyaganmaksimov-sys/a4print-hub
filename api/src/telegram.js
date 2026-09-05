import { createHash, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

const TELEGRAM_API = 'https://api.telegram.org';
const INTEGRATION_CODE = 'main';
const STATUS_VALUES = new Set(['NEW','READ','IN_WORK','ORDER_CREATED','CLOSED']);

function keyFromSecret(secret) {
  return createHash('sha256').update(`${secret}:a4print:telegram:v1`).digest();
}

function encryptToken(token, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFromSecret(secret), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

function decryptToken(value, secret) {
  const [version, ivPart, tagPart, dataPart] = String(value || '').split('.');
  if (version !== 'v1' || !ivPart || !tagPart || !dataPart) throw new Error('TELEGRAM_TOKEN_STORAGE_INVALID');
  const decipher = createDecipheriv('aes-256-gcm', keyFromSecret(secret), Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8');
}

async function telegramCall(token, method, body = {}) {
  const response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    const error = new Error(data.description || `Telegram ${method} failed`);
    error.status = response.status || 502;
    error.code = data.error_code || 'TELEGRAM_API_ERROR';
    throw error;
  }
  return data.result;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function publicBaseUrl() {
  return String(process.env.PUBLIC_API_BASE_URL || process.env.API_PUBLIC_URL || 'https://a4print-hub-api.onrender.com').replace(/\/+$/, '');
}

function messageKind(message) {
  if (message?.text) return 'text';
  if (message?.photo) return 'photo';
  if (message?.document) return 'document';
  if (message?.voice) return 'voice';
  if (message?.contact) return 'contact';
  if (message?.location) return 'location';
  return 'other';
}

function messageText(message) {
  if (message?.text) return String(message.text);
  if (message?.caption) return String(message.caption);
  if (message?.contact) return `Контакт: ${message.contact.phone_number || ''} ${message.contact.first_name || ''}`.trim();
  if (message?.location) return `Геопозиция: ${message.location.latitude}, ${message.location.longitude}`;
  if (message?.document) return `Файл: ${message.document.file_name || 'документ'}`;
  if (message?.photo) return 'Фото';
  if (message?.voice) return 'Голосовое сообщение';
  return 'Сообщение Telegram';
}

export function registerTelegramRoutes({ app, supabase, requireAdmin, serviceKey }) {
  if (!app || !supabase || !requireAdmin || !serviceKey) return;

  const loadIntegration = async () => {
    const { data, error } = await supabase.from('telegram_integrations').select('*').eq('code', INTEGRATION_CODE).maybeSingle();
    if (error) throw error;
    return data;
  };

  const tokenFor = row => decryptToken(row.bot_token_encrypted, serviceKey);

  app.get('/api/v1/integrations/telegram/status', requireAdmin, async (_req, res, next) => {
    try {
      const row = await loadIntegration();
      if (!row) return res.json({ success: true, connected: false, enabled: false, accept_orders: true, auto_reply: true });
      res.json({
        success: true,
        connected: true,
        enabled: row.enabled,
        bot_id: row.bot_id,
        bot_username: row.bot_username,
        accept_orders: row.accept_orders,
        auto_reply: row.auto_reply,
        updated_at: row.updated_at
      });
    } catch (e) { next(e); }
  });

  app.put('/api/v1/integrations/telegram/config', requireAdmin, async (req, res, next) => {
    try {
      const existing = await loadIntegration();
      const rawToken = String(req.body?.token || '').trim();
      if (!existing && !rawToken) return res.status(400).json({ success: false, error: 'TELEGRAM_TOKEN_REQUIRED', message: 'Укажите токен Telegram-бота.' });

      const token = rawToken || tokenFor(existing);
      const me = await telegramCall(token, 'getMe');
      const enabled = bool(req.body?.enabled, existing?.enabled ?? true);
      const acceptOrders = bool(req.body?.accept_orders, existing?.accept_orders ?? true);
      const autoReply = bool(req.body?.auto_reply, existing?.auto_reply ?? true);
      const webhookSecret = rawToken || !existing?.webhook_secret ? randomBytes(24).toString('hex') : existing.webhook_secret;

      if (enabled) {
        await telegramCall(token, 'setWebhook', {
          url: `${publicBaseUrl()}/api/v1/integrations/telegram/webhook`,
          secret_token: webhookSecret,
          allowed_updates: ['message', 'edited_message'],
          drop_pending_updates: false
        });
      } else {
        await telegramCall(token, 'deleteWebhook', { drop_pending_updates: false });
      }

      const payload = {
        code: INTEGRATION_CODE,
        enabled,
        bot_id: me.id,
        bot_username: me.username || null,
        bot_token_encrypted: rawToken ? encryptToken(rawToken, serviceKey) : existing.bot_token_encrypted,
        webhook_secret: webhookSecret,
        accept_orders: acceptOrders,
        auto_reply: autoReply,
        updated_at: new Date().toISOString(),
        updated_by: req.authUser?.id || null
      };
      const { data, error } = await supabase.from('telegram_integrations').upsert(payload, { onConflict: 'code' }).select('code,enabled,bot_id,bot_username,accept_orders,auto_reply,updated_at').single();
      if (error) throw error;
      res.json({ success: true, connected: true, ...data });
    } catch (e) { next(e); }
  });

  app.post('/api/v1/integrations/telegram/test', requireAdmin, async (_req, res, next) => {
    try {
      const row = await loadIntegration();
      if (!row) return res.status(404).json({ success: false, error: 'TELEGRAM_NOT_CONNECTED' });
      const token = tokenFor(row);
      const [me, webhook] = await Promise.all([
        telegramCall(token, 'getMe'),
        telegramCall(token, 'getWebhookInfo')
      ]);
      res.json({
        success: true,
        bot: { id: me.id, username: me.username || null, first_name: me.first_name || null },
        webhook: {
          url: webhook.url || '',
          pending_update_count: webhook.pending_update_count || 0,
          last_error_message: webhook.last_error_message || null,
          last_error_date: webhook.last_error_date || null
        }
      });
    } catch (e) { next(e); }
  });

  app.delete('/api/v1/integrations/telegram', requireAdmin, async (_req, res, next) => {
    try {
      const row = await loadIntegration();
      if (row) {
        try { await telegramCall(tokenFor(row), 'deleteWebhook', { drop_pending_updates: false }); } catch (e) { console.warn('Telegram deleteWebhook failed', e.message); }
        const { error } = await supabase.from('telegram_integrations').delete().eq('code', INTEGRATION_CODE);
        if (error) throw error;
      }
      res.json({ success: true, connected: false });
    } catch (e) { next(e); }
  });

  app.post('/api/v1/integrations/telegram/webhook', async (req, res, next) => {
    try {
      const row = await loadIntegration();
      if (!row?.enabled) return res.json({ ok: true, ignored: true });
      if (!safeEqual(req.headers['x-telegram-bot-api-secret-token'], row.webhook_secret)) {
        return res.status(403).json({ ok: false, error: 'INVALID_TELEGRAM_SECRET' });
      }

      const update = req.body || {};
      const message = update.message || update.edited_message;
      if (!message?.chat?.id || update.update_id == null) return res.json({ ok: true, ignored: true });

      const from = message.from || {};
      const record = {
        update_id: update.update_id,
        chat_id: message.chat.id,
        telegram_message_id: message.message_id || null,
        telegram_user_id: from.id || null,
        username: from.username || null,
        first_name: from.first_name || null,
        last_name: from.last_name || null,
        message_type: messageKind(message),
        message_text: messageText(message).slice(0, 10000),
        raw: update,
        status: 'NEW',
        updated_at: new Date().toISOString()
      };
      const { data: saved, error } = await supabase
        .from('telegram_messages')
        .upsert(record, { onConflict: 'update_id', ignoreDuplicates: true })
        .select('id')
        .maybeSingle();
      if (error) throw error;

      if (saved?.id && row.auto_reply) {
        const token = tokenFor(row);
        await telegramCall(token, 'sendMessage', {
          chat_id: message.chat.id,
          text: row.accept_orders
            ? 'Спасибо! Сообщение получено в A4PRINT HUB. Менеджер увидит его и сможет оформить заказ.'
            : 'Спасибо! Сообщение получено в A4PRINT HUB. Менеджер ответит вам в Telegram.'
        }).catch(e => console.warn('Telegram auto reply failed', e.message));
      }
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  app.get('/api/v1/integrations/telegram/messages', requireAdmin, async (req, res, next) => {
    try {
      const status = String(req.query.status || '').trim().toUpperCase();
      const q = String(req.query.q || '').trim().toLowerCase();
      let query = supabase.from('telegram_messages')
        .select('id,update_id,chat_id,telegram_message_id,telegram_user_id,username,first_name,last_name,message_type,message_text,status,linked_order_id,created_at,updated_at')
        .order('created_at', { ascending: false })
        .limit(200);
      if (STATUS_VALUES.has(status)) query = query.eq('status', status);
      const { data, error } = await query;
      if (error) throw error;
      const rows = (data || []).filter(row => !q || [row.username, row.first_name, row.last_name, row.message_text, row.chat_id].some(v => String(v || '').toLowerCase().includes(q)));
      res.json({ success: true, messages: rows });
    } catch (e) { next(e); }
  });

  app.patch('/api/v1/integrations/telegram/messages/:id', requireAdmin, async (req, res, next) => {
    try {
      const status = String(req.body?.status || '').trim().toUpperCase();
      if (!STATUS_VALUES.has(status)) return res.status(400).json({ success: false, error: 'INVALID_TELEGRAM_MESSAGE_STATUS' });
      const { data, error } = await supabase.from('telegram_messages').update({ status, updated_at: new Date().toISOString() }).eq('id', req.params.id).select('id,status').single();
      if (error) throw error;
      res.json({ success: true, message: data });
    } catch (e) { next(e); }
  });

  app.post('/api/v1/integrations/telegram/messages/:id/reply', requireAdmin, async (req, res, next) => {
    try {
      const text = String(req.body?.text || '').trim().slice(0, 4000);
      if (!text) return res.status(400).json({ success: false, error: 'REPLY_TEXT_REQUIRED' });
      const [row, integration] = await Promise.all([
        supabase.from('telegram_messages').select('id,chat_id').eq('id', req.params.id).single(),
        loadIntegration()
      ]);
      if (row.error) throw row.error;
      if (!integration?.enabled) return res.status(409).json({ success: false, error: 'TELEGRAM_NOT_ENABLED' });
      const sent = await telegramCall(tokenFor(integration), 'sendMessage', { chat_id: row.data.chat_id, text });
      await supabase.from('telegram_messages').update({ status: 'IN_WORK', updated_at: new Date().toISOString() }).eq('id', req.params.id);
      res.json({ success: true, telegram_message_id: sent.message_id });
    } catch (e) { next(e); }
  });

  app.post('/api/v1/integrations/telegram/messages/:id/create-order', requireAdmin, async (req, res, next) => {
    try {
      const businessUnit = String(req.body?.business_unit || 'A4_PRINT').toUpperCase() === '3D_ARTPRINT' ? '3D_ARTPRINT' : 'A4_PRINT';
      const { data: order, error } = await supabase.rpc('create_order_from_telegram', {
        p_message_id: req.params.id,
        p_business_unit: businessUnit
      });
      if (error) throw error;
      res.json({ success: true, order });
    } catch (e) { next(e); }
  });
}
