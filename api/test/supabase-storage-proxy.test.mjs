import test from 'node:test';
import assert from 'node:assert/strict';
import { storageRequestBody } from '../src/supabase-storage-proxy.js';

test('storageRequestBody leaves binary uploads intact', () => {
  const buffer=Buffer.from([1,2,3,4]);
  assert.strictEqual(storageRequestBody({body:buffer},'POST'),buffer);
});

test('storageRequestBody serializes JSON parsed by express.json', () => {
  const body={prefixes:['expense-receipts/user/file.pdf']};
  assert.equal(storageRequestBody({body},'DELETE'),JSON.stringify(body));
});

test('storageRequestBody omits bodies for GET and HEAD', () => {
  assert.equal(storageRequestBody({body:{ignored:true}},'GET'),undefined);
  assert.equal(storageRequestBody({body:{ignored:true}},'HEAD'),undefined);
});

test('storageRequestBody handles empty bodies', () => {
  assert.equal(storageRequestBody({body:null},'DELETE'),undefined);
  assert.equal(storageRequestBody({},'POST'),undefined);
});
