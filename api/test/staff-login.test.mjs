import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeLogin, validUsername, resolveLoginEmail, LoginLookupError} from '../src/staff-login.js';

test('normalize and validate human-friendly logins', () => {
  assert.equal(normalizeLogin('  Operator_1  '), 'operator_1');
  assert.equal(validUsername('operator_1'), true);
  assert.equal(validUsername('123operator'), true);
  assert.equal(validUsername('xx'), false);
  assert.equal(validUsername('bad@name'), false);
  assert.equal(validUsername('../user'), false);
});

test('lookup succeeds without exposing auth email in the browser', async () => {
  let calls = 0;
  const service = {
    from(table) {
      assert.equal(table, 'staff_login_aliases');
      return {
        select(fields) {
          assert.equal(fields, 'auth_user_id');
          return {
            eq(field, value) {
              assert.equal(field, 'username');
              assert.equal(value, 'operator_1');
              return {maybeSingle: async () => ({data: {auth_user_id: 'user-1'}, error: null})};
            }
          };
        }
      };
    },
    auth: {admin: {getUserById: async id => {
      calls++; assert.equal(id, 'user-1');
      return {data: {user: {email: 'operator@example.com'}}, error: null};
    }}}
  };
  assert.equal(await resolveLoginEmail(' Operator_1 ', service), 'operator@example.com');
  assert.equal(calls, 1);
});

test('unknown login always returns null, without returning account email', async () => {
  const service = {from: () => ({select: () => ({eq: () => ({maybeSingle: async () => ({data: null, error: null})})})})};
  assert.equal(await resolveLoginEmail('notknown', service), null);
  assert.equal(await resolveLoginEmail('invalid login', service), null);
});

test('legacy email sign-in stays compatible while clients update', async () => {
  assert.equal(await resolveLoginEmail('OPERATOR@example.com', null), 'operator@example.com');
  assert.equal(await resolveLoginEmail('malformed@', null), null);
});

test('lookup outage does not masquerade as a wrong password', async () => {
  const service = {from: () => ({select: () => ({eq: () => ({maybeSingle: async () => ({data: null, error: {code: 'PGRST205'}})})})})};
  await assert.rejects(resolveLoginEmail('operator_1', service), LoginLookupError);
  await assert.rejects(resolveLoginEmail('operator_1', null), LoginLookupError);
});
