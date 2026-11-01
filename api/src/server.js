import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { syncMoySkladCatalog, fetchMoySkladStock, createRetailSale, createRetailReturn, repairMoySkladSaleItems, getRetailShiftStatus, openRetailShift, closeRetailShift } from './moysklad.js';
import { requireMoySkladOrganization, moySkladTenantError } from './pos-moysklad-tenant.js';
import { registerPosMoySkladInvoices } from './pos-invoices.js';

const app = express();
const port = Number(process.env.PORT || 3000);

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
    if (/^http:\/\/(?:127\.0\.0\.1|localhost):4784[1-3]$/.test(origin)) return callback(null, true);
    return callback(new Error(`CORS_ORIGIN_DENIED: ${origin}`));
  },
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'X-A4PRINT-STAFF-TOKEN'],
  maxAge: 86400
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

app.get('/api/v1/health', (_q, r) => r.json({
  success: true,
  service: 'a4print-hub-api',
  status: 'ok',
  databaseConfigured: Boolean(supabase),
  moyskladConfigured: Boolean(process.env.MOYSKLAD_TOKEN)
}));

async function authContext(req) {
  if (!supabaseUrl || !publishableKey) throw new Error('AUTH_NOT_CONFIGURED');
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return { error: 'AUTH_REQUIRED' };
  const c = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data, error } = await c.auth.getClaims(token);
  const claims = data?.claims;
  if (error || !claims?.sub) return { error: 'INVALID_SESSION' };
  return { client: c, user: { id: String(claims.sub), email: String(claims.email || '') } };
}

async function requireAdmin(req, res, next) {
  try {
    const ctx = await authContext(req);
    if (ctx.error) return res.status(401).json({ success: false, error: ctx.error });
    const staffToken = req.headers['x-a4print-staff-token'];
    if (staffToken) {
      const payload = verifyPosStaffToken(staffToken, ctx.user.id);
      if (!payload) return res.status(401).json({ success: false, error: 'POS_STAFF_PIN_REQUIRED' });
      const staff = await loadPosStaffProfile(payload.staff_id);
      if (!staff || staff.is_active === false || staff.organization_id !== payload.organization_id) {
        return res.status(403).json({ success: false, error: 'POS_STAFF_DISABLED' });
      }
      if (!staff.isAdmin) return res.status(403).json({ success: false, error: 'ADMIN_REQUIRED' });
      req.authUser = ctx.user;
      req.authProfile = staff;
      req.staffOrganizationId = staff.organization_id;
      req.isAdmin = true;
      return next();
    }
    const { data: isAdmin, error } = await ctx.client.rpc('has_role', { required_role: 'ADMIN' });
    if (error) throw error;
    if (!isAdmin) return res.status(403).json({ success: false, error: 'ADMIN_REQUIRED' });
    req.authUser = ctx.user;
    next();
  } catch (e) { next(e); }
}

async function organizationIdForUnit(unitId) {
  if (!supabase || !unitId) return null;
  const { data, error } = await supabase.from('organization_units').select('organization_id,is_active').eq('id', unitId).maybeSingle();
  if (error) throw error;
  if (!data || data.is_active === false) return null;
  return data.organization_id || null;
}

async function operatorProfile(authUserId) {
  if (!supabase || !authUserId) return null;
  const { data, error } = await supabase
    .from('users')
    .select('id,full_name,email,is_active,organization_unit_id,organization_units(organization_id,is_active)')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const unit = data.organization_units;
  const { organization_units: _unit, ...profile } = data;
  return {
    ...profile,
    organization_id: unit && unit.is_active !== false ? unit.organization_id || null : null
  };
}

async function requireAdminOrganization(req, res, next) {
  try {
    const profile = req.authProfile || await operatorProfile(req.authUser?.id);
    if (!profile?.id || !profile?.organization_unit_id || !profile?.organization_id) {
      return res.status(403).json({
        success: false,
        error: 'ADMIN_ORGANIZATION_REQUIRED',
        message: 'Администратор не привязан к подразделению организации.'
      });
    }
    req.authProfile = profile;
    req.staffOrganizationId = profile.organization_id;
    next();
  } catch (e) { next(e); }
}

async function posStaffAccess(authUserId) {
  if (!supabase || !authUserId) return null;
  const { data, error } = await supabase
    .from('users')
    .select('id,full_name,email,is_active,organization_unit_id,organization_units(organization_id,is_active),user_roles(roles(name))')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const unit = data.organization_units;
  const roles = (data.user_roles || []).map(row => String(row?.roles?.name || '').trim().toUpperCase()).filter(Boolean);
  const { organization_units: _unit, user_roles: _userRoles, ...profile } = data;
  return {
    profile: {
      ...profile,
      organization_id: unit && unit.is_active !== false ? unit.organization_id || null : null
    },
    roles,
    isAdmin: roles.includes('ADMIN'),
    isOperator: roles.includes('POS_OPERATOR')
  };
}

const posStaffTokenSecret = process.env.POS_STAFF_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const POS_STAFF_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const POS_PIN_MAX_ATTEMPTS = 5;
const POS_PIN_LOCK_MS = 5 * 60 * 1000;

function hashStaffPin(pin, salt = randomBytes(16).toString('base64url')) {
  return { salt, hash: scryptSync(String(pin), salt, 64).toString('hex') };
}
function validStaffPin(pin) { return /^\d{4,8}$/.test(String(pin || '')); }
function signPosStaffToken(payload) {
  if (!posStaffTokenSecret) throw new Error('POS_STAFF_TOKEN_SECRET_NOT_CONFIGURED');
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', posStaffTokenSecret).update(encoded).digest('base64url');
  return encoded + '.' + signature;
}
function verifyPosStaffToken(token, authUserId) {
  try {
    if (!posStaffTokenSecret || !token) return null;
    const [encoded, signature] = String(token).split('.');
    if (!encoded || !signature) return null;
    const expected = createHmac('sha256', posStaffTokenSecret).update(encoded).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (payload.auth_sub !== authUserId || !payload.staff_id || !payload.organization_id || Number(payload.exp) <= Date.now()) return null;
    return payload;
  } catch { return null; }
}
async function loadPosStaffProfile(userId) {
  const { data, error } = await supabase.from('users')
    .select('id,full_name,email,phone,position,is_active,organization_unit_id,organization_units(organization_id,is_active),user_roles(roles(name))')
    .eq('id', userId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const unit = data.organization_units;
  const roles = (data.user_roles || []).map(row => String(row?.roles?.name || '').trim().toUpperCase()).filter(Boolean);
  const { organization_units: _unit, user_roles: _roles, ...profile } = data;
  return {
    ...profile,
    organization_id: unit && unit.is_active !== false ? unit.organization_id || null : null,
    roles,
    isAdmin: roles.includes('ADMIN'),
    isOperator: roles.includes('POS_OPERATOR')
  };
}
async function listPosStaff(organizationId) {
  const { data: units, error: unitsError } = await supabase.from('organization_units').select('id,name')
    .eq('organization_id', organizationId).eq('is_active', true);
  if (unitsError) throw unitsError;
  const unitIds = (units || []).map(row => row.id);
  if (!unitIds.length) return [];
  const { data: roleRows, error: rolesError } = await supabase.from('roles').select('id,name').in('name', ['ADMIN','POS_OPERATOR']);
  if (rolesError) throw rolesError;
  const roleIds = (roleRows || []).map(row => row.id);
  if (!roleIds.length) return [];
  const { data: assignments, error: assignmentsError } = await supabase.from('user_roles').select('user_id,role_id').in('role_id', roleIds);
  if (assignmentsError) throw assignmentsError;
  const userIds = [...new Set((assignments || []).map(row => row.user_id))];
  if (!userIds.length) return [];
  const { data: staff, error: staffError } = await supabase.from('users')
    .select('id,full_name,email,phone,position,is_active,organization_unit_id,created_at')
    .in('id', userIds).in('organization_unit_id', unitIds).order('full_name');
  if (staffError) throw staffError;
  const { data: credentials, error: credentialsError } = await supabase.from('pos_staff_credentials').select('user_id');
  if (credentialsError) throw credentialsError;
  const enabled = new Set((credentials || []).map(row => row.user_id));
  const roleNameById = new Map((roleRows || []).map(row => [row.id, row.name]));
  const rolesByUser = new Map();
  for (const assignment of assignments || []) {
    const roles = rolesByUser.get(assignment.user_id) || [];
    const roleName = roleNameById.get(assignment.role_id);
    if (roleName && !roles.includes(roleName)) roles.push(roleName);
    rolesByUser.set(assignment.user_id, roles);
  }
  const unitNameById = new Map((units || []).map(row => [row.id, row.name]));
  return (staff || []).map(row => ({ ...row, unit_name: unitNameById.get(row.organization_unit_id) || '', roles: rolesByUser.get(row.id) || [], pin_enabled: enabled.has(row.id) }));
}
async function requirePosAdmin(req, res, next) {
  if (!req.isAdmin) return res.status(403).json({ success: false, error: 'ADMIN_REQUIRED' });
  next();
}

async function requirePosUser(req, res, next) {
  const startedAt = Date.now();
  try {
    const ctx = await authContext(req);
    if (ctx.error) return res.status(401).json({ success: false, error: ctx.error });
    const staffToken = req.headers['x-a4print-staff-token'];
    const tokenPayload = verifyPosStaffToken(staffToken, ctx.user.id);
    if (!tokenPayload) return res.status(401).json({ success: false, error: 'POS_STAFF_PIN_REQUIRED', message: 'Выберите сотрудника и введите PIN-код.' });
    const profile = await loadPosStaffProfile(tokenPayload.staff_id);
    if (!profile || profile.is_active === false || profile.organization_id !== tokenPayload.organization_id) {
      return res.status(403).json({ success: false, error: 'POS_STAFF_DISABLED', message: 'Профиль сотрудника отключён или изменён.' });
    }
    if (!profile.isAdmin && !profile.isOperator) return res.status(403).json({ success: false, error: 'POS_ACCESS_REQUIRED' });
    const posTenant = await requireMoySkladOrganization({
      service: supabase,
      authUserId: ctx.user.id,
      organizationId: profile.organization_id,
      posApp: true
    });
    if (!posTenant.ok) return moySkladTenantError(res, posTenant);
    req.authUser = ctx.user;
    req.authClient = ctx.client;
    req.authProfile = profile;
    req.staffOrganizationId = profile.organization_id;
    req.posOrganizationId = posTenant.organization.id;
    req.isAdmin = Boolean(profile.isAdmin);
    req.isOperator = Boolean(profile.isOperator);
    req.posStaffToken = tokenPayload;
    const durationMs = Date.now() - startedAt;
    if (durationMs >= 500) console.warn('[POS_AUTH_TIMING]', JSON.stringify({ duration_ms: durationMs }));
    next();
  } catch (e) { next(e); }
}

async function resolvePosOperator(req, requestedId) {
  const own = req.authProfile || await operatorProfile(req.authUser?.id);
  if (!req.isAdmin || !requestedId || !supabase) return own;
  const { data, error } = await supabase.from('users').select('id,full_name,email,is_active,organization_unit_id').eq('id', requestedId).maybeSingle();
  if (error) throw error;
  if (!data || data.is_active === false) return own;
  const organizationId = await organizationIdForUnit(data.organization_unit_id);
  return organizationId === req.posOrganizationId ? { ...data, organization_id: organizationId } : own;
}

// Shared cashier account bootstrap and PIN-based employee identity.
app.get('/api/v1/pos/staff/login-list', requireAdmin, async (req, res, next) => {
  try {
    const { data: org, error: orgError } = await supabase.from('organizations').select('id').eq('code','A4PRINT').eq('is_active',true).single();
    if (orgError) throw orgError;
    const staff = await listPosStaff(org.id);
    const activeStaff=staff.filter(row=>row.is_active);
    const hasAdminPin=activeStaff.some(row=>row.roles?.includes('ADMIN')&&row.pin_enabled);
    const bootstrapCandidates=hasAdminPin?[]:activeStaff.filter(row=>row.roles?.includes('ADMIN')&&!row.pin_enabled);
    res.json({
      success:true,
      staff:activeStaff,
      bootstrap_required:bootstrapCandidates.length>0,
      bootstrap_candidates:bootstrapCandidates.map(row=>({id:row.id,full_name:row.full_name,position:row.position||'',email:row.email||'',unit_name:row.unit_name||''}))
    });
  } catch(e){next(e)}
});

app.post('/api/v1/pos/staff/pin-login', requireAdmin, async (req, res, next) => {
  try {
    const staffId = cleanText(req.body?.staff_id,80);
    const pin = String(req.body?.pin || '');
    if (!staffId || !validStaffPin(pin)) return res.status(400).json({success:false,error:'INVALID_PIN_FORMAT',message:'PIN должен содержать от 4 до 8 цифр.'});
    const staff = await loadPosStaffProfile(staffId);
    if (!staff || staff.is_active === false || staff.organization_id !== (await supabase.from('organizations').select('id').eq('code','A4PRINT').single()).data?.id || (!staff.isAdmin && !staff.isOperator)) {
      return res.status(404).json({success:false,error:'STAFF_NOT_AVAILABLE',message:'Сотрудник недоступен.'});
    }
    const {data:credential,error} = await supabase.from('pos_staff_credentials').select('*').eq('user_id',staffId).maybeSingle();
    if(error)throw error;
    if(!credential)return res.status(409).json({success:false,error:'PIN_NOT_SET',message:'Для сотрудника ещё не назначен PIN. Обратитесь к администратору.'});
    if(credential.locked_until && new Date(credential.locked_until).getTime()>Date.now()) {
      return res.status(429).json({success:false,error:'PIN_TEMPORARILY_LOCKED',message:'Слишком много попыток. Попробуйте через несколько минут.'});
    }
    const candidate=hashStaffPin(pin,credential.pin_salt).hash;
    const a=Buffer.from(candidate,'hex'),b=Buffer.from(credential.pin_hash,'hex');
    const valid=a.length===b.length&&timingSafeEqual(a,b);
    if(!valid){
      const attempts=Number(credential.failed_attempts||0)+1;
      const locked=attempts>=POS_PIN_MAX_ATTEMPTS?new Date(Date.now()+POS_PIN_LOCK_MS).toISOString():null;
      const {error:updateError}=await supabase.from('pos_staff_credentials').update({failed_attempts:locked?0:attempts,locked_until:locked,updated_at:new Date().toISOString()}).eq('user_id',staffId);
      if(updateError)throw updateError;
      return res.status(401).json({success:false,error:'PIN_INVALID',message:locked?'PIN заблокирован на 5 минут после пяти неверных попыток.':'Неверный PIN-код.'});
    }
    const {error:resetError}=await supabase.from('pos_staff_credentials').update({failed_attempts:0,locked_until:null,updated_at:new Date().toISOString()}).eq('user_id',staffId);
    if(resetError)throw resetError;
    const token=signPosStaffToken({staff_id:staff.id,auth_sub:req.authUser.id,organization_id:staff.organization_id,exp:Date.now()+POS_STAFF_TOKEN_TTL_MS});
    res.json({success:true,token,expires_at:new Date(Date.now()+POS_STAFF_TOKEN_TTL_MS).toISOString(),staff:{id:staff.id,full_name:staff.full_name,position:staff.position||'',organization_unit_id:staff.organization_unit_id,organization_id:staff.organization_id,roles:staff.roles,isAdmin:staff.isAdmin,isOperator:staff.isOperator}});
  }catch(e){next(e)}
});

app.post('/api/v1/pos/staff/bootstrap-pin', requireAdmin, async (req,res,next)=>{
  try{
    const pin=String(req.body?.pin||'');
    if(!validStaffPin(pin))return res.status(400).json({success:false,error:'INVALID_PIN_FORMAT',message:'PIN должен содержать от 4 до 8 цифр.'});
    const access=await posStaffAccess(req.authUser.id);
    if(!access?.isAdmin)return res.status(403).json({success:false,error:'ADMIN_REQUIRED'});
    const staffId=cleanText(req.body?.staff_id,80);
    const target=staffId?await loadPosStaffProfile(staffId):null;
    const {data:org,error:orgError}=await supabase.from('organizations').select('id').eq('code','A4PRINT').eq('is_active',true).single();
    if(orgError)throw orgError;
    if(!target||target.is_active===false||target.organization_id!==org.id||!target.isAdmin)
      return res.status(404).json({success:false,error:'BOOTSTRAP_ADMIN_NOT_FOUND',message:'Выберите активного администратора А4-Принт.'});
    const existing=await supabase.from('pos_staff_credentials').select('user_id').eq('user_id',target.id).maybeSingle();
    if(existing.error)throw existing.error;
    if(existing.data)return res.status(409).json({success:false,error:'PIN_ALREADY_SET',message:'PIN этого администратора уже настроен.'});
    const hashed=hashStaffPin(pin);
    const {error}=await supabase.from('pos_staff_credentials').insert({user_id:target.id,pin_salt:hashed.salt,pin_hash:hashed.hash});
    if(error)throw error;
    res.json({success:true});
  }catch(e){next(e)}
});

app.get('/api/v1/pos/staff', requirePosUser, requirePosAdmin, async(req,res,next)=>{
  try{res.json({success:true,staff:await listPosStaff(req.posOrganizationId)})}catch(e){next(e)}
});
app.post('/api/v1/pos/staff', requirePosUser, requirePosAdmin, async(req,res,next)=>{
  try{
    const fullName=cleanText(req.body?.full_name,160);
    const pin=String(req.body?.pin||'');
    const position=cleanText(req.body?.position,100);
    if(!fullName||!validStaffPin(pin))return res.status(400).json({success:false,error:'INVALID_STAFF_DATA',message:'Укажите ФИО и PIN от 4 до 8 цифр.'});
    let {data:unit,error:unitError}=await supabase.from('organization_units').select('id').eq('organization_id',req.posOrganizationId).eq('name','Менеджеры и продажи').eq('is_active',true).maybeSingle();
    if(unitError)throw unitError;
    if(!unit&&req.authProfile.organization_unit_id){
      const fallback=await supabase.from('organization_units').select('id').eq('id',req.authProfile.organization_unit_id).eq('organization_id',req.posOrganizationId).eq('is_active',true).maybeSingle();
      if(fallback.error)throw fallback.error;
      unit=fallback.data;
    }
    if(!unit)return res.status(400).json({success:false,error:'STAFF_UNIT_REQUIRED',message:'Не найдено активное подразделение для кассиров.'});
    const {data:profile,error:profileError}=await supabase.from('users').insert({full_name:fullName,position:position||null,is_active:true,organization_unit_id:unit.id}).select('id,full_name,position,is_active,organization_unit_id').single();
    if(profileError)throw profileError;
    const {data:role,error:roleError}=await supabase.from('roles').select('id').eq('name','POS_OPERATOR').single();
    if(roleError)throw roleError;
    const {error:assignError}=await supabase.from('user_roles').insert({user_id:profile.id,role_id:role.id});
    if(assignError){await supabase.from('users').update({is_active:false}).eq('id',profile.id);throw assignError}
    const hashed=hashStaffPin(pin);
    const {error:pinError}=await supabase.from('pos_staff_credentials').insert({user_id:profile.id,pin_salt:hashed.salt,pin_hash:hashed.hash});
    if(pinError){await supabase.from('users').update({is_active:false}).eq('id',profile.id);throw pinError}
    res.status(201).json({success:true,staff:{...profile,pin_enabled:true}});
  }catch(e){next(e)}
});
app.patch('/api/v1/pos/staff/:id', requirePosUser, requirePosAdmin, async(req,res,next)=>{
  try{
    const staff=await loadPosStaffProfile(req.params.id);
    if(!staff||staff.organization_id!==req.posOrganizationId)return res.status(404).json({success:false,error:'STAFF_NOT_FOUND'});
    if(staff.id===req.authProfile.id&&req.body?.is_active===false)return res.status(400).json({success:false,error:'CANNOT_DISABLE_SELF',message:'Нельзя отключить собственную учётную запись.'});
    const updates={};
    if(typeof req.body?.full_name==='string'&&req.body.full_name.trim())updates.full_name=cleanText(req.body.full_name,160);
    if(typeof req.body?.position==='string')updates.position=cleanText(req.body.position,100)||null;
    if(typeof req.body?.is_active==='boolean')updates.is_active=req.body.is_active;
    if(Object.keys(updates).length){
      const {error}=await supabase.from('users').update(updates).eq('id',staff.id);
      if(error)throw error;
    }
    res.json({success:true});
  }catch(e){next(e)}
});
app.put('/api/v1/pos/staff/:id/pin', requirePosUser, requirePosAdmin, async(req,res,next)=>{
  try{
    const staff=await loadPosStaffProfile(req.params.id);
    if(!staff||staff.organization_id!==req.posOrganizationId)return res.status(404).json({success:false,error:'STAFF_NOT_FOUND'});
    const pin=String(req.body?.pin||'');
    if(!validStaffPin(pin))return res.status(400).json({success:false,error:'INVALID_PIN_FORMAT',message:'PIN должен содержать от 4 до 8 цифр.'});
    const hashed=hashStaffPin(pin);
    const {error}=await supabase.from('pos_staff_credentials').upsert({user_id:staff.id,pin_salt:hashed.salt,pin_hash:hashed.hash,failed_attempts:0,locked_until:null,updated_at:new Date().toISOString()},{onConflict:'user_id'});
    if(error)throw error;
    res.json({success:true});
  }catch(e){next(e)}
});

const cleanText = (value, max = 500) => String(value || '').trim().slice(0, max);
const customerFields = 'id,organization_id,full_name,company_name,email,phone,notes,created_at,updated_at';

function customerView(row) {
  if (!row) return null;
  return {
    id: row.id,
    full_name: row.full_name,
    company_name: row.company_name || '',
    email: row.email || '',
    phone: row.phone || '',
    notes: row.notes || ''
  };
}

const msReady = res => {
  if (!supabase) { res.status(503).json({ success: false, error: 'DATABASE_NOT_CONFIGURED' }); return false; }
  if (!process.env.MOYSKLAD_TOKEN) { res.status(503).json({ success: false, error: 'MOYSKLAD_NOT_CONFIGURED' }); return false; }
  return true;
};

async function msTenantReady(req, res) {
  const result = await requireMoySkladOrganization({
    service: supabase,
    authUserId: req.authUser?.id || null,
    organizationId: req.posOrganizationId || null,
    posApp: true
  });
  if (!result.ok) { moySkladTenantError(res, result); return false; }
  // Keep every downstream POS query on the same resolved tenant.
  req.posOrganizationId = result.organization.id;
  return true;
}

function normalizeSaleItems(items = []) {
  return (Array.isArray(items) ? items : []).map((x, index) => ({
    id: cleanText(x?.key, 160) || `${x?.id || 'item'}:${index}`,
    catalog_id: x?.id || null,
    name: cleanText(x?.name, 300) || 'Позиция',
    quantity: Math.max(0, Number(x?.qty || 0)),
    price: Math.max(0, Number(x?.price || 0)),
    discount: Math.min(100, Math.max(0, Number(x?.discount || 0)))
  }));
}

async function getPosSaleWithReturns(id, organizationId = null) {
  let saleQuery = supabase
    .from('pos_sales')
    .select('id,organization_id,shift_session_id,moysklad_shift_id,moysklad_sale_id,moysklad_sale_name,operator_id,customer_id,cash_account_id,payment_method,total,items,sold_at')
    .eq('id', id);
  if (organizationId) saleQuery = saleQuery.eq('organization_id', organizationId);
  const { data: sale, error } = await saleQuery.maybeSingle();
  if (error) throw error;
  if (!sale) return null;
  const { data: returns, error: returnsError } = await supabase
    .from('pos_returns')
    .select('id,amount,items,returned_at,moysklad_return_id,moysklad_return_name')
    .eq('pos_sale_id', sale.id)
    .order('returned_at', { ascending: true });
  if (returnsError) throw returnsError;
  const returned = new Map();
  for (const r of returns || []) {
    for (const item of Array.isArray(r.items) ? r.items : []) {
      const key = cleanText(item.position_id || item.id, 160);
      if (key) returned.set(key, (returned.get(key) || 0) + Math.max(0, Number(item.qty || item.quantity || 0)));
    }
  }
  const positions = normalizeSaleItems(sale.items).map(p => ({
    ...p,
    sold_quantity: p.quantity,
    returned_quantity: returned.get(p.id) || 0,
    quantity: Math.max(0, p.quantity - (returned.get(p.id) || 0))
  }));
  return { sale, returns: returns || [], positions };
}

app.post('/api/v1/integrations/moysklad/sync', requireAdmin, async (req, res, next) => {
  try {
    if (!msReady(res)) return;
    if (!(await msTenantReady(req, res))) return;
    const { data: org, error } = await supabase.from('organizations').select('id').eq('code', 'A4PRINT').single();
    if (error) throw error;
    const result = await syncMoySkladCatalog({ supabase, token: process.env.MOYSKLAD_TOKEN, organizationId: org.id });
    res.json({ success: true, ...result });
  } catch (e) { next(e); }
});

app.get('/api/v1/integrations/moysklad/stock', requirePosUser, async (req, res, next) => {
  try {
    if (!msReady(res)) return;
    if (!(await msTenantReady(req, res))) return;
    const stock = await fetchMoySkladStock(process.env.MOYSKLAD_TOKEN);
    res.json({ success: true, stock });
  } catch (e) { next(e); }
});

app.get('/api/v1/pos/shift', requirePosUser, async (req, res, next) => {
  try {
    if (!msReady(res)) return;
    if (!(await msTenantReady(req, res))) return;
    const status = await getRetailShiftStatus(process.env.MOYSKLAD_TOKEN);
    res.json({ success: true, ...status });
  } catch (e) { next(e); }
});

app.post('/api/v1/pos/shift/open', requirePosUser, async (req, res, next) => {
  try {
    if (!msReady(res)) return;
    if (!(await msTenantReady(req, res))) return;
    const profile = await resolvePosOperator(req, cleanText(req.body?.operator_id, 80));
    const result = await openRetailShift(process.env.MOYSKLAD_TOKEN, { operatorName: profile?.full_name || req.authUser.email });
    res.json({ success: true, alreadyOpen: result.alreadyOpen, shift: { id: result.shift?.id, name: result.shift?.name, openDate: result.shift?.openDate || result.shift?.moment || result.shift?.created }, store: { id: result.store?.id, name: result.store?.name }, operator: { id: profile?.id || null, name: profile?.full_name || req.authUser.email } });
  } catch (e) { next(e); }
});

app.post('/api/v1/pos/shift/close', requirePosUser, async (req, res, next) => {
  try {
    if (!msReady(res)) return;
    const profile = await resolvePosOperator(req, cleanText(req.body?.operator_id, 80));
    const result = await closeRetailShift(process.env.MOYSKLAD_TOKEN, { operatorName: profile?.full_name || req.authUser.email });
    res.json({ success: true, shift: { id: result.shift?.id, name: result.shift?.name, closeDate: result.shift?.closeDate }, store: { id: result.store?.id, name: result.store?.name }, operator: { id: profile?.id || null, name: profile?.full_name || req.authUser.email } });
  } catch (e) { next(e); }
});

app.get('/api/v1/pos/accounts', requirePosUser, async (req, res, next) => {
  try {
    if (!supabase) return res.status(503).json({ success: false, error: 'DATABASE_NOT_CONFIGURED' });
    const { data, error } = await supabase
      .from('cash_accounts')
      .select('id,name,account_type,is_active')
      .eq('organization_id', req.posOrganizationId)
      .eq('is_active', true)
      .order('name');
    if (error) throw error;
    res.json({ success: true, accounts: data || [] });
  } catch (e) { next(e); }
});

app.get('/api/v1/pos/catalog', requirePosUser, async(req,res,next)=>{
  try{
    const {data,error}=await supabase.rpc('get_pos_catalog');
    if(error)throw error;
    res.json({success:true,catalog:data||[]});
  }catch(e){next(e)}
});

app.get('/api/v1/pos/operators', requirePosUser, async(req,res,next)=>{
  try{
    const staff=await listPosStaff(req.posOrganizationId);
    const operators=staff.filter(row=>row.is_active&&row.roles?.includes('POS_OPERATOR')&&(req.isAdmin||row.id===req.authProfile.id))
      .map(row=>({id:row.id,full_name:row.full_name,email:row.email||'',is_active:row.is_active,is_self:row.id===req.authProfile.id}));
    res.json({success:true,operators});
  }catch(e){next(e)}
});

app.get('/api/v1/pos/reports/dashboard', requirePosUser, async(req,res,next)=>{
  try{
    const from=cleanText(req.query.from,60),to=cleanText(req.query.to,60);
    const fromDate=from?new Date(from):new Date(Date.now()-30*86400000);
    const toDate=to?new Date(to):new Date();
    if(!Number.isFinite(fromDate.getTime())||!Number.isFinite(toDate.getTime())||fromDate>=toDate)
      return res.status(400).json({success:false,error:'INVALID_REPORT_RANGE'});
    let operatorId=req.authProfile.id;
    if(req.isAdmin){
      const requested=cleanText(req.query.operator_id,80);
      operatorId=null;
      if(requested){
        const selected=await loadPosStaffProfile(requested);
        if(!selected||selected.is_active===false||selected.organization_id!==req.posOrganizationId||!selected.isOperator)
          return res.status(400).json({success:false,error:'INVALID_REPORT_OPERATOR'});
        operatorId=selected.id;
      }
    }
    const {data,error}=await req.authClient.rpc('pos_dashboard',{
      p_from:fromDate.toISOString(),p_to:toDate.toISOString(),p_operator_id:operatorId
    });
    if(error)throw error;
    res.json({success:true,dashboard:data||{}});
  }catch(e){next(e)}
});

app.get('/api/v1/pos/history', requirePosUser, async(req,res,next)=>{
  try{
    const limit=Math.min(300,Math.max(1,Number(req.query.limit)||150));
    let query=supabase.from('pos_sales')
      .select('id,moysklad_sale_id,moysklad_sale_name,moysklad_shift_id,payment_method,total,item_count,items,sold_at,sync_status,operator_id,customer_id,cash_account_id,shift_session_id')
      .eq('organization_id',req.posOrganizationId)
      .order('sold_at',{ascending:false}).limit(limit);
    if(!req.isAdmin)query=query.eq('operator_id',req.authProfile.id);
    const {data:sales,error}=await query;
    if(error)throw error;
    const rows=sales||[];
    const ids=rows.map(row=>row.id);
    const operatorIds=[...new Set(rows.map(row=>row.operator_id).filter(Boolean))];
    const customerIds=[...new Set(rows.map(row=>row.customer_id).filter(Boolean))];
    const accountIds=[...new Set(rows.map(row=>row.cash_account_id).filter(Boolean))];
    const shiftIds=[...new Set(rows.map(row=>row.shift_session_id).filter(Boolean))];
    const [users,customers,accounts,shifts,returns]=await Promise.all([
      operatorIds.length?supabase.from('users').select('id,full_name').in('id',operatorIds):Promise.resolve({data:[],error:null}),
      customerIds.length?supabase.from('customers').select('id,full_name').in('id',customerIds):Promise.resolve({data:[],error:null}),
      accountIds.length?supabase.from('cash_accounts').select('id,name').in('id',accountIds):Promise.resolve({data:[],error:null}),
      shiftIds.length?supabase.from('pos_shift_sessions').select('id,moysklad_shift_name').in('id',shiftIds):Promise.resolve({data:[],error:null}),
      ids.length?supabase.from('pos_returns').select('pos_sale_id,amount').in('pos_sale_id',ids):Promise.resolve({data:[],error:null})
    ]);
    for(const result of [users,customers,accounts,shifts,returns])if(result.error)throw result.error;
    const userMap=new Map((users.data||[]).map(row=>[row.id,row.full_name]));
    const customerMap=new Map((customers.data||[]).map(row=>[row.id,row.full_name]));
    const accountMap=new Map((accounts.data||[]).map(row=>[row.id,row.name]));
    const shiftMap=new Map((shifts.data||[]).map(row=>[row.id,row.moysklad_shift_name]));
    const returnedMap=new Map();
    for(const row of returns.data||[])returnedMap.set(row.pos_sale_id,(returnedMap.get(row.pos_sale_id)||0)+Number(row.amount||0));
    let history=rows.map(row=>({
      id:row.id,moysklad_sale_id:row.moysklad_sale_id,sale_name:row.moysklad_sale_name,
      shift_id:null,shift_name:shiftMap.get(row.shift_session_id)||'—',sold_at:row.sold_at,
      payment_method:row.payment_method,total:Number(row.total||0),item_count:Number(row.item_count||0),
      items:row.items||[],sync_status:row.sync_status==='IMPORTED_MS'?'Импортирован из МойСклад':row.sync_status==='SYNCED'?'Синхронизирован':row.sync_status||'—',
      operator_id:row.operator_id,operator:userMap.get(row.operator_id)||(row.sync_status==='IMPORTED_MS'?'Не указан в МойСклад':'Неизвестно'),
      customer_id:row.customer_id,customer:customerMap.get(row.customer_id)||null,
      cash_account:accountMap.get(row.cash_account_id)||null,returned_total:returnedMap.get(row.id)||0,returned_count:0
    }));
    const search=cleanText(req.query.q,120).toLowerCase();
    if(search)history=history.filter(row=>[row.sale_name,row.operator,row.customer,row.payment_method,row.total,...(Array.isArray(row.items)?row.items.map(item=>item?.name):[])].join(' ').toLowerCase().includes(search));
    res.json({success:true,rows:history});
  }catch(e){next(e)}
});

app.get('/api/v1/pos/sale/sync-state', requirePosUser, async(req,res,next)=>{
  try{
    const id=cleanText(req.query.moysklad_sale_id,160);
    if(!id)return res.status(400).json({success:false,error:'SALE_ID_REQUIRED'});
    let query=supabase.from('pos_sales').select('id,operator_id,sync_status').eq('organization_id',req.posOrganizationId).eq('moysklad_sale_id',id).order('updated_at',{ascending:false}).limit(1);
    if(!req.isAdmin)query=query.eq('operator_id',req.authProfile.id);
    const {data,error}=await query.maybeSingle();
    if(error)throw error;
    res.json({success:true,found:Boolean(data),synced:Boolean(data&&data.sync_status==='SYNCED')});
  }catch(e){next(e)}
});

app.post('/api/v1/pos/sale/record', requirePosUser, async(req,res,next)=>{
  try{
    const input=req.body||{};
    const saleId=cleanText(input.p_moysklad_sale_id,160);
    if(!saleId)return res.status(400).json({success:false,error:'SALE_ID_REQUIRED'});
    let operatorId=req.authProfile.id;
    if(!req.isAdmin&&input.p_operator_id&&String(input.p_operator_id)!==String(req.authProfile.id))
      return res.status(403).json({success:false,error:'SALE_OPERATOR_MISMATCH',message:'Чек создан другим сотрудником. Войдите под его PIN или попросите администратора.'});
    if(req.isAdmin&&input.p_operator_id){
      const selected=await loadPosStaffProfile(cleanText(input.p_operator_id,80));
      if(!selected||selected.is_active===false||selected.organization_id!==req.posOrganizationId||!selected.isOperator)
        return res.status(400).json({success:false,error:'INVALID_SALE_OPERATOR'});
      operatorId=selected.id;
    }
    const args={
      p_moysklad_sale_id:saleId,
      p_moysklad_sale_name:cleanText(input.p_moysklad_sale_name,200)||null,
      p_moysklad_shift_id:cleanText(input.p_moysklad_shift_id,160)||null,
      p_operator_id:operatorId,
      p_customer_id:cleanText(input.p_customer_id,80)||null,
      p_cash_account_id:cleanText(input.p_cash_account_id,80)||null,
      p_payment_method:cleanText(input.p_payment_method,80)||'Наличные',
      p_total:Math.max(0,Number(input.p_total)||0),
      p_items:Array.isArray(input.p_items)?input.p_items:[]
    };
    const rpc=cleanText(input.rpc,40)==='record_pos_sale_v2'?'record_pos_sale_v2':'record_pos_sale';
    if(rpc==='record_pos_sale_v2')args.p_order_id=cleanText(input.p_order_id,80)||null;
    const {data,error}=await req.authClient.rpc(rpc,args);
    if(error)throw error;
    res.json({success:true,id:data,operator_id:operatorId});
  }catch(e){next(e)}
});

app.get('/api/v1/pos/customers', requirePosUser, async (req, res, next) => {
  try {
    if (!supabase) return res.status(503).json({ success: false, error: 'DATABASE_NOT_CONFIGURED' });
    const q = cleanText(req.query.q, 100).replace(/[,%()]/g, ' ');
    if (q.length < 2) return res.json({ success: true, customers: [] });
    const { data, error } = await supabase
      .from('customers')
      .select(customerFields)
      .eq('organization_id', req.posOrganizationId)
      .or(`full_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%,company_name.ilike.%${q}%`)
      .order('updated_at', { ascending: false })
      .limit(12);
    if (error) throw error;
    res.json({ success: true, customers: (data || []).map(customerView) });
  } catch (e) { next(e); }
});

app.post('/api/v1/pos/customers', requirePosUser, async (req, res, next) => {
  try {
    if (!supabase) return res.status(503).json({ success: false, error: 'DATABASE_NOT_CONFIGURED' });
    const profile = req.authProfile || await operatorProfile(req.authUser.id);
    if (profile && profile.is_active === false) return res.status(403).json({ success: false, error: 'OPERATOR_DISABLED' });

    const id = cleanText(req.body?.id, 80) || null;
    const fullName = cleanText(req.body?.full_name, 200);
    const phone = cleanText(req.body?.phone, 80);
    const email = cleanText(req.body?.email, 200).toLowerCase();
    const companyName = cleanText(req.body?.company_name, 200);
    const managerComment = cleanText(req.body?.manager_comment, 1500);
    if (!fullName) return res.status(400).json({ success: false, error: 'CUSTOMER_NAME_REQUIRED', message: 'Укажите имя клиента.' });

    let existing = null;
    if (id) {
      const { data, error } = await supabase.from('customers').select(customerFields).eq('organization_id', req.posOrganizationId).eq('id', id).maybeSingle();
      if (error) throw error;
      existing = data;
    }
    if (!existing && phone) {
      const { data, error } = await supabase.from('customers').select(customerFields).eq('organization_id', req.posOrganizationId).eq('phone', phone).limit(1).maybeSingle();
      if (error) throw error;
      existing = data;
    }
    if (!existing && email) {
      const { data, error } = await supabase.from('customers').select(customerFields).eq('organization_id', req.posOrganizationId).eq('email', email).limit(1).maybeSingle();
      if (error) throw error;
      existing = data;
    }

    const operatorName = profile?.full_name || req.authUser.email || 'Оператор';
    let notes = existing?.notes || '';
    if (managerComment) {
      const stamp = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
      const line = `[${stamp}] ${operatorName}: ${managerComment}`;
      notes = notes ? `${notes}\n${line}` : line;
    }

    const payload = {
      organization_id: req.posOrganizationId,
      full_name: fullName,
      company_name: companyName || null,
      email: email || null,
      phone: phone || null,
      notes: notes || null,
      updated_at: new Date().toISOString()
    };

    let saved;
    if (existing?.id) {
      const { data, error } = await supabase.from('customers').update(payload).eq('organization_id', req.posOrganizationId).eq('id', existing.id).select(customerFields).single();
      if (error) throw error;
      saved = data;
    } else {
      const { data, error } = await supabase.from('customers').insert(payload).select(customerFields).single();
      if (error) throw error;
      saved = data;
    }

    res.status(existing ? 200 : 201).json({ success: true, customer: customerView(saved) });
  } catch (e) { next(e); }
});

app.post('/api/v1/pos/sale', requirePosUser, async (req, res, next) => {
  try {
    if (!msReady(res)) return;
    if (!(await msTenantReady(req, res))) return;
    const input = req.body || {};
    if (!Array.isArray(input.items) || !input.items.length) return res.status(400).json({ success: false, error: 'EMPTY_CART' });
    const ids = input.items.map(x => x.id);
    const { data: rows, error } = await supabase.from('catalog_items').select('id,name,sku,article,sale_price,external_id,external_href,item_type').eq('organization_id', req.posOrganizationId).in('id', ids);
    if (error) throw error;
    const byId = new Map((rows || []).map(x => [x.id, x]));
    const items = input.items.map(x => {
      const g = byId.get(x.id);
      if (!g) throw new Error('Товар не найден: ' + x.id);
      const price = Number(x.price ?? g.sale_price ?? 0);
      const discount = Math.min(100, Math.max(0, Number(x.discount || 0)));
      if (!Number.isFinite(price) || price < 0) throw new Error('Некорректная цена: ' + g.name);
      return {
        id: g.id,
        name: g.name,
        qty: Math.max(1, Number(x.qty || 1)),
        price,
        discount,
        external_href: g.external_href,
        external_type: g.external_href?.split('/').slice(-2, -1)[0] || (g.item_type === 'SERVICE' ? 'service' : 'product'),
        sku: g.sku || null,
        article: g.article || null
      };
    });
    if (!req.isAdmin && input.operator_id && String(input.operator_id) !== String(req.authProfile.id)) return res.status(403).json({ success: false, error: 'SALE_OPERATOR_MISMATCH', message: 'Чек создан другим сотрудником. Для синхронизации войдите под его PIN или попросите администратора.' });
    const profile = await resolvePosOperator(req, cleanText(input.operator_id, 80));
    if (profile && profile.is_active === false) return res.status(403).json({ success: false, error: 'OPERATOR_DISABLED' });
    const operatorName = profile?.full_name || req.authUser.email || 'Оператор';

    let customer = null;
    const customerId = cleanText(input.customer_id, 80);
    if (customerId) {
      const { data, error: customerError } = await supabase.from('customers').select(customerFields).eq('organization_id', req.posOrganizationId).eq('id', customerId).maybeSingle();
      if (customerError) throw customerError;
      if (!data) return res.status(400).json({ success: false, error: 'CUSTOMER_NOT_AVAILABLE', message: 'Клиент недоступен для текущей компании.' });
      customer = data;
    }

    let saleItems=items;
    let repairedCatalog=null;
    let sale;
    try{
      sale=await createRetailSale({
        token:process.env.MOYSKLAD_TOKEN,
        items:saleItems,
        paymentMethod:input.payment_method,
        operatorName,
        customer:customer?{name:customer.full_name,phone:customer.phone,company:customer.company_name}:null
      });
    }catch(error){
      repairedCatalog=await repairMoySkladSaleItems({
        token:process.env.MOYSKLAD_TOKEN,
        items:saleItems,
        error
      });
      if(!repairedCatalog?.changed){
        if(repairedCatalog?.missing){
          const label=repairedCatalog.target?.name||repairedCatalog.missing.id;
          throw new Error(`Позиция «${label}» была удалена или изменена в МойСклад. Обновите каталог кассы и повторите отправку чека.`);
        }
        throw error;
      }

      saleItems=repairedCatalog.items;
      const replacement=repairedCatalog.replacement;
      const target=repairedCatalog.target;
      try{
        const existing=await supabase.from('catalog_items')
          .select('id')
          .eq('organization_id',req.posOrganizationId)
          .eq('external_source','MOYSKLAD')
          .eq('external_id',replacement.id)
          .maybeSingle();
        if(existing.error)throw existing.error;
        if(!existing.data||existing.data.id===target.id){
          const update=await supabase.from('catalog_items').update({
            external_id:replacement.id,
            external_href:replacement.href,
            external_updated_at:replacement.updated,
            last_synced_at:new Date().toISOString(),
            is_active:true
          }).eq('organization_id',req.posOrganizationId).eq('id',target.id);
          if(update.error)throw update.error;
        }else{
          const retire=await supabase.from('catalog_items').update({
            is_active:false,
            last_synced_at:new Date().toISOString()
          }).eq('organization_id',req.posOrganizationId).eq('id',target.id);
          if(retire.error)throw retire.error;
        }
      }catch(catalogError){
        console.warn('POS stale MoySklad assortment repair persistence warning:',catalogError?.message||catalogError);
      }

      sale=await createRetailSale({
        token:process.env.MOYSKLAD_TOKEN,
        items:saleItems,
        paymentMethod:input.payment_method,
        operatorName,
        customer:customer?{name:customer.full_name,phone:customer.phone,company:customer.company_name}:null
      });

      // Refresh/deactivate the rest of the catalog after a successful repair,
      // but never hold the cashier response on a full catalog scan.
      syncMoySkladCatalog({
        supabase,
        token:process.env.MOYSKLAD_TOKEN,
        organizationId:req.posOrganizationId
      }).catch(syncError=>console.warn('POS catalog refresh after repair warning:',syncError?.message||syncError));
    }
    res.json({
      success: true,
      operator: { id: profile?.id || null, name: operatorName },
      customer: customerView(customer),
      moysklad: { id: sale.id, name: sale.name, href: sale.meta?.href },
      sum: Number(sale.sum || 0) / 100
    });
  } catch (e) { next(e); }
});

app.get('/api/v1/pos/returns/sales', requirePosUser, async (req, res, next) => {
  try {
    if (!supabase) return res.status(503).json({ success: false, error: 'DATABASE_NOT_CONFIGURED' });
    let { data: rows, error } = await supabase
      .from('pos_sales')
      .select('id,moysklad_sale_id,moysklad_sale_name,total,payment_method,sold_at,items')
      .eq('organization_id', req.posOrganizationId)
      .order('sold_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    // KASSA is pinned to the A4PRINT POS tenant. Older/transition sales may have
    // been recorded under that tenant while the employee profile resolves to a
    // different HUB organization. If the profile-scoped list is empty, use the
    // server-side A4PRINT organization as a safe POS-only fallback.
    if (!(rows || []).length) {
      const { data: a4, error: a4Error } = await supabase.from('organizations')
        .select('id').eq('code', 'A4PRINT').eq('is_active', true).limit(1).maybeSingle();
      if (a4Error) throw a4Error;
      if (a4?.id && a4.id !== req.posOrganizationId) {
        const fallback = await supabase.from('pos_sales')
          .select('id,moysklad_sale_id,moysklad_sale_name,total,payment_method,sold_at,items')
          .eq('organization_id', a4.id)
          .order('sold_at', { ascending: false })
          .limit(100);
        if (fallback.error) throw fallback.error;
        rows = fallback.data || [];
      }
    }
    const ids = (rows || []).map(x => x.id);
    let returnRows = [];
    if (ids.length) {
      const r = await supabase.from('pos_returns').select('pos_sale_id,amount,items').in('pos_sale_id', ids);
      if (r.error) throw r.error;
      returnRows = r.data || [];
    }
    const bySale = new Map();
    for (const r of returnRows) {
      const current = bySale.get(r.pos_sale_id) || { amount: 0, qty: 0 };
      current.amount += Number(r.amount || 0);
      current.qty += (Array.isArray(r.items) ? r.items : []).reduce((s, x) => s + Number(x.qty || x.quantity || 0), 0);
      bySale.set(r.pos_sale_id, current);
    }
    const sales = (rows || []).map(x => {
      const returned = bySale.get(x.id) || { amount: 0, qty: 0 };
      const soldQty = normalizeSaleItems(x.items).reduce((s, p) => s + p.quantity, 0);
      return {
        id: x.id,
        external_id: x.moysklad_sale_id,
        name: x.moysklad_sale_name || x.moysklad_sale_id,
        sum: Number(x.total || 0),
        moment: x.sold_at,
        description: `${x.payment_method || 'Оплата'}${returned.amount > 0 ? ` · возвращено ${returned.amount.toFixed(2)} ₽` : ''}`,
        returnable: returned.qty < soldQty
      };
    });
    res.json({ success: true, sales });
  } catch (e) { next(e); }
});

app.get('/api/v1/pos/returns/sales/:id', requirePosUser, async (req, res, next) => {
  try {
    const state = await getPosSaleWithReturns(req.params.id, req.posOrganizationId);
    if (!state) return res.status(404).json({ success: false, error: 'SALE_NOT_FOUND', message: 'Продажа не найдена в кассе.' });
    res.json({
      success: true,
      sale: {
        id: state.sale.id,
        external_id: state.sale.moysklad_sale_id,
        name: state.sale.moysklad_sale_name || state.sale.moysklad_sale_id,
        sum: Number(state.sale.total || 0),
        moment: state.sale.sold_at,
        payment_method: state.sale.payment_method,
        positions: state.positions
      }
    });
  } catch (e) { next(e); }
});

app.post('/api/v1/pos/returns', requirePosUser, async (req, res, next) => {
  try {
    if (!msReady(res)) return;
    if (!(await msTenantReady(req, res))) return;
    const saleId = cleanText(req.body?.sale_id, 80);
    const reason = cleanText(req.body?.reason, 1200);
    const paymentMethod = cleanText(req.body?.payment_method, 80) || 'Наличные';
    const accountId = cleanText(req.body?.account_id, 80);
    const requested = Array.isArray(req.body?.positions) ? req.body.positions : [];
    if (!saleId || !requested.length) return res.status(400).json({ success: false, error: 'RETURN_POSITIONS_REQUIRED', message: 'Выберите позиции для возврата.' });
    if (!reason) return res.status(400).json({ success: false, error: 'RETURN_REASON_REQUIRED', message: 'Укажите причину возврата.' });
    if (!accountId) return res.status(400).json({ success: false, error: 'RETURN_ACCOUNT_REQUIRED', message: 'Выберите счёт возврата.' });

    const state = await getPosSaleWithReturns(saleId, req.posOrganizationId);
    if (!state) return res.status(404).json({ success: false, error: 'SALE_NOT_FOUND', message: 'Исходная продажа не найдена.' });
    const { data: account, error: accountError } = await supabase.from('cash_accounts').select('id,organization_id,is_active').eq('id', accountId).maybeSingle();
    if (accountError) throw accountError;
    if (!account || !account.is_active || account.organization_id !== state.sale.organization_id) return res.status(400).json({ success: false, error: 'INVALID_RETURN_ACCOUNT', message: 'Счёт возврата недоступен.' });

    const available = new Map(state.positions.map(p => [p.id, p]));
    const selected = [];
    for (const raw of requested) {
      const id = cleanText(raw?.id, 160);
      const qty = Number(raw?.quantity || 0);
      const p = available.get(id);
      if (!p || !(qty > 0)) continue;
      if (qty > p.quantity + 1e-9) return res.status(400).json({ success: false, error: 'RETURN_QTY_EXCEEDS_AVAILABLE', message: `Нельзя вернуть больше доступного количества: ${p.name}.` });
      selected.push({ ...p, qty });
    }
    if (!selected.length) return res.status(400).json({ success: false, error: 'RETURN_POSITIONS_REQUIRED', message: 'Нет доступных позиций для возврата.' });

    const catalogIds = [...new Set(selected.map(x => x.catalog_id).filter(Boolean))];
    const { data: catalog, error: catalogError } = await supabase.from('catalog_items').select('id,external_href,item_type').eq('organization_id', req.posOrganizationId).in('id', catalogIds);
    if (catalogError) throw catalogError;
    const catalogById = new Map((catalog || []).map(x => [x.id, x]));
    const msItems = selected.map(x => {
      const g = catalogById.get(x.catalog_id);
      if (!g?.external_href) throw new Error(`Позиция «${x.name}» не связана с МойСклад.`);
      return {
        id: x.catalog_id,
        name: x.name,
        qty: x.qty,
        price: x.price,
        discount: Math.min(100, Math.max(0, Number(x.discount || 0))),
        external_href: g.external_href,
        external_type: g.external_href.split('/').slice(-2, -1)[0] || (g.item_type === 'SERVICE' ? 'service' : 'product')
      };
    });
    const profile = req.authProfile || await operatorProfile(req.authUser.id);
    if (profile && profile.is_active === false) return res.status(403).json({ success: false, error: 'OPERATOR_DISABLED' });
    const operatorName = profile?.full_name || req.authUser.email || 'Оператор';

    const ret = await createRetailReturn({
      token: process.env.MOYSKLAD_TOKEN,
      saleId: state.sale.moysklad_sale_id,
      items: msItems,
      paymentMethod,
      operatorName,
      reason
    });
    const amount = selected.reduce((s, x) => s + Number(x.price || 0) * Number(x.qty || 0) * (1 - Number(x.discount || 0) / 100), 0);
    const returnShiftId = ret.retailShift?.id || ret.retailShift?.meta?.href?.split('/').pop() || null;
    let shiftSessionId = null;
    if (returnShiftId) {
      const shiftRow = await supabase.from('pos_shift_sessions').select('id').eq('organization_id', state.sale.organization_id).eq('moysklad_shift_id', returnShiftId).order('opened_at', { ascending: false }).limit(1).maybeSingle();
      if (shiftRow.error) throw shiftRow.error;
      shiftSessionId = shiftRow.data?.id || null;
    }
    const savedItems = selected.map(x => ({ position_id: x.id, catalog_id: x.catalog_id, name: x.name, qty: x.qty, price: x.price, discount: Math.min(100, Math.max(0, Number(x.discount || 0))) }));
    const { data: savedReturn, error: saveError } = await supabase.from('pos_returns').insert({
      organization_id: state.sale.organization_id,
      shift_session_id: shiftSessionId,
      pos_sale_id: state.sale.id,
      moysklad_return_id: ret.id,
      moysklad_return_name: ret.name || null,
      operator_id: profile?.id || null,
      cash_account_id: account.id,
      payment_method: paymentMethod,
      amount,
      items: savedItems,
      reason,
      returned_at: new Date().toISOString(),
      sync_status: 'SYNCED'
    }).select('id').single();
    if (saveError) throw new Error(`Возврат создан в МойСклад, но не записан в HUB: ${saveError.message}`);

    const category = await supabase.from('cash_categories').select('id').eq('organization_id', state.sale.organization_id).eq('direction', 'EXPENSE').eq('name', 'Возврат клиенту').maybeSingle();
    if (category.error) throw category.error;
    const cashPayload = {
      organization_id: state.sale.organization_id,
      cash_account_id: account.id,
      category_id: category.data?.id || null,
      customer_id: state.sale.customer_id || null,
      direction: 'EXPENSE',
      amount,
      payment_method: paymentMethod,
      description: `Возврат по продаже ${state.sale.moysklad_sale_name || state.sale.moysklad_sale_id} · ${reason}`,
      transaction_date: new Date().toISOString().slice(0, 10),
      created_by: profile?.id || null,
      external_source: 'MOYSKLAD_POS_RETURN',
      external_id: ret.id
    };
    const cash = await supabase.from('cash_transactions').upsert(cashPayload, { onConflict: 'organization_id,external_source,external_id,direction', ignoreDuplicates: true });
    if (cash.error) console.warn('POS return cash sync warning:', cash.error.message);

    res.status(201).json({ success: true, id: savedReturn.id, return: { id: ret.id, name: ret.name || ret.id }, amount });
  } catch (e) { next(e); }
});

app.get('/api/v1/operators', requireAdmin, requireAdminOrganization, async (req, res, next) => {
  try {
    const { data: role, error: roleErr } = await supabase.from('roles').select('id').eq('name', 'POS_OPERATOR').single();
    if (roleErr) throw roleErr;

    const { data: units, error: unitErr } = await supabase
      .from('organization_units')
      .select('id')
      .eq('organization_id', req.staffOrganizationId)
      .eq('is_active', true);
    if (unitErr) throw unitErr;
    const unitIds = (units || []).map(x => x.id);
    if (!unitIds.length) return res.json({ success: true, operators: [] });

    const { data: roleRows, error: roleRowsErr } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('role_id', role.id);
    if (roleRowsErr) throw roleRowsErr;
    const userIds = (roleRows || []).map(x => x.user_id);
    if (!userIds.length) return res.json({ success: true, operators: [] });

    const { data, error } = await supabase
      .from('users')
      .select('id,auth_user_id,full_name,email,phone,is_active,created_at,organization_unit_id')
      .in('id', userIds)
      .in('organization_unit_id', unitIds)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, operators: data || [] });
  } catch (e) { next(e); }
});

app.post('/api/v1/operators', requireAdmin, requireAdminOrganization, async (req, res, next) => {
  try {
    if (!supabase) return res.status(503).json({ success: false, error: 'DATABASE_NOT_CONFIGURED' });
    const fullName = String(req.body?.full_name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!fullName || !email || password.length < 6) return res.status(400).json({ success: false, error: 'INVALID_OPERATOR_DATA', message: 'Укажите имя, email и пароль не короче 6 символов.' });

    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
    if (authErr) throw authErr;
    const authUser = authData.user;
    try {
      const { data: profile, error: pErr } = await supabase.from('users').upsert({
        auth_user_id: authUser.id,
        full_name: fullName,
        email,
        is_active: true,
        organization_unit_id: req.authProfile.organization_unit_id
      }, { onConflict: 'auth_user_id' }).select('id,organization_unit_id').single();
      if (pErr) throw pErr;
      const { data: role, error: rErr } = await supabase.from('roles').select('id').eq('name', 'POS_OPERATOR').single();
      if (rErr) throw rErr;
      const { error: urErr } = await supabase.from('user_roles').upsert({ user_id: profile.id, role_id: role.id });
      if (urErr) throw urErr;
      res.status(201).json({ success: true, operator: { id: profile.id, auth_user_id: authUser.id, full_name: fullName, email, is_active: true } });
    } catch (e) {
      await supabase.auth.admin.deleteUser(authUser.id).catch(() => {});
      throw e;
    }
  } catch (e) { next(e); }
});

app.patch('/api/v1/operators/:id', requireAdmin, requireAdminOrganization, async (req, res, next) => {
  try {
    const { data: operator, error: findErr } = await supabase
      .from('users')
      .select('id,auth_user_id,organization_unit_id,organization_units!users_organization_unit_id_fkey(organization_id)')
      .eq('id', req.params.id)
      .single();
    if (findErr) throw findErr;
    if (operator?.organization_units?.organization_id !== req.staffOrganizationId) {
      return res.status(404).json({ success: false, error: 'OPERATOR_NOT_FOUND' });
    }
    const updates = {};
    if (typeof req.body?.full_name === 'string') updates.full_name = req.body.full_name.trim();
    if (typeof req.body?.is_active === 'boolean') updates.is_active = req.body.is_active;
    if (Object.keys(updates).length) {
      const { error } = await supabase.from('users').update(updates).eq('id', operator.id);
      if (error) throw error;
    }
    const authUpdates = {};
    if (typeof req.body?.password === 'string' && req.body.password) {
      if (req.body.password.length < 6) return res.status(400).json({ success: false, error: 'PASSWORD_TOO_SHORT', message: 'Минимум 6 символов.' });
      authUpdates.password = req.body.password;
    }
    if (typeof req.body?.is_active === 'boolean') authUpdates.ban_duration = req.body.is_active ? 'none' : '876000h';
    if (Object.keys(authUpdates).length && operator.auth_user_id) {
      const { error } = await supabase.auth.admin.updateUserById(operator.auth_user_id, authUpdates);
      if (error) throw error;
    }
    res.json({ success: true });
  } catch (e) { next(e); }
});

registerPosMoySkladInvoices(app,requirePosUser,msReady,msTenantReady,()=>process.env.MOYSKLAD_TOKEN);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR', message: err.message });
});

app.listen(port, () => console.log(`A4PRINT HUB API listening on port ${port}`));
