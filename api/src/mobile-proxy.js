import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { registerTelegramRoutes } from './telegram.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const internalPort = Number(process.env.MOBILE_INTERNAL_API_PORT || 3001);
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

const configuredOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(v => v.trim())
  .filter(Boolean);
const trustedOrigins = new Set([
  ...configuredOrigins,
  'https://a4print-hub.ru',
  'https://www.a4print-hub.ru',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173'
]);
const corsOptions = {
  origin(origin, callback) {
    if (!origin || trustedOrigins.has('*') || trustedOrigins.has(origin)) return callback(null, true);
    if (/^https:\/\/[a-z0-9-]+\.a4print-hub\.ru$/i.test(origin)) return callback(null, true);
    return callback(new Error(`CORS_ORIGIN_DENIED: ${origin}`));
  },
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'X-Telegram-Bot-Api-Secret-Token'],
  maxAge: 86400
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));

const service = supabaseUrl && serviceKey
  ? createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

app.get('/api/v1/mobile/health', (_req, res) => res.json({
  success: true,
  service: 'a4print-hub-mobile-api',
  mobileAuth: true,
  authConfigured: Boolean(supabaseUrl && publishableKey),
  databaseConfigured: Boolean(service)
}));

app.get('/api/v1/system/health', async (_req, res, next) => {
  try {
    if (!service) {
      return res.status(503).json({ success: false, status: 'UNKNOWN', error: 'DATABASE_NOT_CONFIGURED' });
    }
    const { data, error } = await service
      .from('system_self_test_runs')
      .select('started_at,finished_at,status,details')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return res.status(503).json({ success: false, status: 'UNKNOWN', error: 'NO_SYSTEM_SELF_TEST_RESULTS' });
    }
    const ageMs = Date.now() - new Date(data.finished_at || data.started_at).getTime();
    const fresh = Number.isFinite(ageMs) && ageMs <= 36 * 60 * 60 * 1000;
    const healthy = data.status === 'PASS' && fresh;
    return res.status(healthy ? 200 : 503).json({
      success: healthy,
      status: data.status,
      fresh,
      started_at: data.started_at,
      finished_at: data.finished_at,
      details: data.details || {}
    });
  } catch (e) { next(e); }
});

function publicClient() {
  if (!supabaseUrl || !publishableKey) return null;
  return createClient(supabaseUrl, publishableKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

function sessionView(session) {
  if (!session) return null;
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    token_type: session.token_type || 'bearer',
    user: session.user ? {
      id: session.user.id,
      email: session.user.email,
      user_metadata: session.user.user_metadata || {}
    } : null
  };
}

function authMessage(error) {
  const msg = String(error?.message || 'Не удалось войти.');
  if (/invalid login credentials/i.test(msg)) return 'Неверный email или пароль.';
  if (/email not confirmed/i.test(msg)) return 'Email ещё не подтверждён.';
  return msg;
}

async function currentUser(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token || !service) return { error: 'AUTH_REQUIRED' };
  const { data, error } = await service.auth.getUser(token);
  if (error || !data?.user) return { error: 'INVALID_SESSION' };
  return { token, user: data.user };
}

async function requireAdmin(req, res, next) {
  try {
    if (!service) return res.status(503).json({ success: false, error: 'DATABASE_NOT_CONFIGURED' });
    const auth = await currentUser(req);
    if (auth.error) return res.status(401).json({ success: false, error: auth.error });
    const { data: profile, error: profileError } = await service
      .from('users')
      .select('id,is_active')
      .eq('auth_user_id', auth.user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile || profile.is_active === false) return res.status(403).json({ success: false, error: 'ADMIN_REQUIRED' });
    const { data: roleRows, error: roleError } = await service
      .from('user_roles')
      .select('roles(name)')
      .eq('user_id', profile.id);
    if (roleError) throw roleError;
    if (!(roleRows || []).some(row => row.roles?.name === 'ADMIN')) return res.status(403).json({ success: false, error: 'ADMIN_REQUIRED' });
    req.authUser = auth.user;
    req.staffProfile = profile;
    next();
  } catch (e) { next(e); }
}

if (service && serviceKey) registerTelegramRoutes({ app, supabase: service, requireAdmin, serviceKey });

app.post('/api/v1/mobile/auth/password', async (req, res, next) => {
  try {
    const client = publicClient();
    if (!client) return res.status(503).json({ success: false, error: 'AUTH_NOT_CONFIGURED', message: 'Авторизация временно недоступна.' });
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({ success: false, error: 'EMAIL_PASSWORD_REQUIRED', message: 'Введите email и пароль.' });

    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data?.session) {
      return res.status(error?.status === 429 ? 429 : 401).json({
        success: false,
        error: 'LOGIN_FAILED',
        message: authMessage(error)
      });
    }
    res.json({ success: true, session: sessionView(data.session) });
  } catch (e) { next(e); }
});

app.post('/api/v1/mobile/auth/refresh', async (req, res, next) => {
  try {
    const client = publicClient();
    if (!client) return res.status(503).json({ success: false, error: 'AUTH_NOT_CONFIGURED' });
    const refreshToken = String(req.body?.refresh_token || '').trim();
    if (!refreshToken) return res.status(400).json({ success: false, error: 'REFRESH_TOKEN_REQUIRED' });
    const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data?.session) return res.status(401).json({ success: false, error: 'REFRESH_FAILED', message: authMessage(error) });
    res.json({ success: true, session: sessionView(data.session) });
  } catch (e) { next(e); }
});

app.get('/api/v1/mobile/bootstrap', async (req, res, next) => {
  try {
    if (!service) return res.status(503).json({ success: false, error: 'DATABASE_NOT_CONFIGURED' });
    const auth = await currentUser(req);
    if (auth.error) return res.status(401).json({ success: false, error: auth.error });

    const { data: profile, error: profileError } = await service
      .from('users')
      .select('id,auth_user_id,full_name,email,phone,is_active,created_at')
      .eq('auth_user_id', auth.user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) return res.status(403).json({ success: false, error: 'STAFF_PROFILE_NOT_FOUND', message: 'Профиль сотрудника не найден.' });
    if (profile.is_active === false) return res.status(403).json({ success: false, error: 'STAFF_DISABLED', message: 'Учётная запись сотрудника отключена.' });

    const [{ data: roleRows, error: rolesError }, { data: orders, error: ordersError }] = await Promise.all([
      service.from('user_roles').select('roles(name)').eq('user_id', profile.id),
      service.from('orders')
        .select('id,order_number,status,total,model_name,source,business_unit,created_at,customers(full_name,company_name)')
        .order('created_at', { ascending: false })
        .limit(100)
    ]);
    if (rolesError) throw rolesError;
    if (ordersError) throw ordersError;

    res.json({
      success: true,
      profile: {
        id: profile.id,
        full_name: profile.full_name,
        email: profile.email,
        phone: profile.phone || '',
        roles: (roleRows || []).map(x => x.roles?.name).filter(Boolean)
      },
      orders: orders || []
    });
  } catch (e) { next(e); }
});

const child = spawn(process.execPath, ['src/server.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(internalPort) },
  stdio: 'inherit'
});
child.on('exit', code => {
  console.error('Internal API exited with code', code);
  process.exit(code || 1);
});
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));

app.use(async (req, res, next) => {
  try {
    const url = `http://127.0.0.1:${internalPort}${req.originalUrl}`;
    const headers = { ...req.headers };
    delete headers.host;
    delete headers['content-length'];
    const method = req.method.toUpperCase();
    const hasBody = !['GET', 'HEAD'].includes(method);
    const response = await fetch(url, {
      method,
      headers,
      body: hasBody && req.body != null ? JSON.stringify(req.body) : undefined
    });
    res.status(response.status);
    response.headers.forEach((value, key) => {
      if (!['content-encoding', 'transfer-encoding', 'content-length', 'connection'].includes(key.toLowerCase())) res.setHeader(key, value);
    });
    const body = Buffer.from(await response.arrayBuffer());
    res.send(body);
  } catch (e) { next(e); }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR', message: err.message });
});

app.listen(port, () => console.log(`A4PRINT HUB mobile proxy listening on port ${port}; internal API ${internalPort}`));
