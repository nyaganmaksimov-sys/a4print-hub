import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const AUTH = 'https://ep-spring-sound-b9j2pelc.neonauth.c-7.eu-central-1.aws.neon.tech/a4print_cloud/auth';
const API = 'https://a4print-neon-cloud-api-staging.onrender.com';
const EMAIL = 'a4print-staging-operator-20261106-5b9cd8@example.com';
const LOGIN = 'staging_operator';
// Use a unique, high-entropy password in this runner only. Never print or persist.
const PASSWORD = 'Z!9a4-' + randomBytes(25).toString('base64url');
const headers = {'Content-Type': 'application/json', Origin: API, Accept: 'application/json'};
const req = (url, data, h = headers) => fetch(url, {
  method: 'POST', headers: h, body: JSON.stringify(data),
  signal: AbortSignal.timeout(18000), redirect: 'manual'
});

async function requireJson(response, status, label) {
  if (response.status !== status) throw new Error(label + ' returned HTTP ' + response.status);
  return response.json();
}

const signup = await req(AUTH + '/sign-up/email', {
  email: EMAIL, password: PASSWORD, name: 'A4PRINT staging test operator'
});
if (!signup.ok) {
  const details = await signup.json().catch(() => ({}));
  const errorCode = String(details?.code || details?.error?.code || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '').slice(0,60);
  throw new Error('Neon Auth synthetic sign-up HTTP ' + signup.status + ' code=' + errorCode + ' keys=' + Object.keys(details).slice(0,8).join(','));
}
console.log('Neon Auth synthetic sign-up succeeded');

const signin = await req(AUTH + '/sign-in/email', {email: EMAIL, password: PASSWORD});
if (!signin.ok) throw new Error('Direct Neon Auth sign-in HTTP ' + signin.status);
const signedIn = await signin.json();
assert.equal(signedIn.user?.email?.toLowerCase(), EMAIL);
assert.ok(signedIn.user?.id);
console.log('Direct Neon Auth email+password verified');

const sessionCookie = (signin.headers.getSetCookie?.() || [])
  .map(s => s.split(';')[0]).filter(s => /session_token/.test(s)).join('; ');
if (!sessionCookie) throw new Error('Neon Auth did not provide a session cookie');

const session = await fetch(AUTH + '/get-session', {
  headers: {Origin: API, Accept: 'application/json', Cookie: sessionCookie},
  signal: AbortSignal.timeout(18000)
});
if (!session.ok) throw new Error('Neon Auth get-session HTTP ' + session.status);
const existing = await session.json();
assert.equal(existing.user?.id, signedIn.user.id);
console.log('Neon Auth session validation succeeded');

const username = await req(API + '/api/v1/cloud/auth/password', {login: LOGIN, password: PASSWORD});
const result = await requireJson(username, 200, 'Render username-login');
assert.equal(result.success, true);
assert.equal(result.passwordVerified, true);
assert.equal(result.sessionIssued, false);
assert.deepEqual(result.permissions, []);
assert.equal(result.environment, 'TEST_ONLY');
console.log('Render -> Neon Auth username+password staging check succeeded');

const wrong = await req(API + '/api/v1/cloud/auth/password', {login: LOGIN, password: 'incorrect-password-1234'});
const wrongResult = await requireJson(wrong, 401, 'Wrong-password check');
assert.equal(wrongResult.error, 'INVALID_LOGIN_OR_PASSWORD');

const unknown = await req(API + '/api/v1/cloud/auth/password', {login: 'staging_unknown', password: PASSWORD});
const unknownResult = await requireJson(unknown, 401, 'Unknown-user check');
assert.equal(unknownResult.error, 'INVALID_LOGIN_OR_PASSWORD');
console.log('Wrong credentials rejected with matching generic responses');

const pos = await fetch(API + '/api/v1/pos/sales', {method:'POST'});
const blocked = await requireJson(pos, 503, 'POS blocking');
assert.equal(blocked.error, 'STAGING_ENDPOINT_DISABLED');
console.log('POS writes remain disabled');
