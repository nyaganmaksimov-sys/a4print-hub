import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { storageRequestBody } from '../src/supabase-storage-proxy.js';

const repoFile=path=>readFileSync(new URL(`../../${path}`,import.meta.url),'utf8');

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

test('A4StorageProxyUrl rewrites only Supabase Storage URLs and preserves signed query', () => {
  const source=repoFile('admin/config.js');
  const start=source.indexOf('window.A4StorageProxyUrl = function a4StorageProxyUrl(rawUrl)');
  const end=source.indexOf('\n\n(function installA4ApiRouting',start);
  assert.ok(start>=0&&end>start,'A4StorageProxyUrl must remain in admin/config.js');

  const sandbox={
    window:{A4PRINT_CONFIG:{supabaseUrl:'https://project.supabase.co',apiBaseUrl:'https://api.example.test'}},
    location:{href:'https://app.example.test/admin/profile.html'},
    URL
  };
  vm.runInNewContext(source.slice(start,end),sandbox);
  const rewrite=sandbox.window.A4StorageProxyUrl;

  const signed='https://project.supabase.co/storage/v1/object/sign/expense-receipts/user/file.pdf?token=abc%20123&download=1';
  assert.equal(
    rewrite(signed),
    'https://api.example.test/api/v1/supabase/storage/v1/object/sign/expense-receipts/user/file.pdf?token=abc%20123&download=1'
  );
  assert.equal(rewrite('https://project.supabase.co/rest/v1/users?id=eq.1'),'https://project.supabase.co/rest/v1/users?id=eq.1');
  assert.equal(rewrite('https://cdn.example.test/avatar.webp'),'https://cdn.example.test/avatar.webp');
});

test('profile and expenses display Storage files through the shared URL helper', () => {
  const profile=repoFile('admin/profile.js');
  const expenses=repoFile('admin/expenses.js');
  assert.match(profile,/const proxied=window\.A4StorageProxyUrl\?window\.A4StorageProxyUrl\(raw\):raw/);
  assert.match(profile,/proxied!==raw/,'avatar must retain a direct fallback when proxy rendering fails');
  assert.match(expenses,/const target=window\.A4StorageProxyUrl\?window\.A4StorageProxyUrl\(data\.signedUrl\):data\.signedUrl/);
});

test('Storage proxy preserves browser download metadata from Supabase', () => {
  const source=repoFile('api/src/supabase-storage-proxy.js');
  assert.match(source,/'content-disposition'/);
  assert.match(source,/'accept-ranges'/);
});
