import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoUrl=new URL('../../',import.meta.url);
const repoPath=relative=>fileURLToPath(new URL(relative,repoUrl));
const read=relative=>readFileSync(repoPath(relative),'utf8');

test('HUB uses one canonical push service worker',()=>{
  assert.equal(existsSync(repoPath('admin/notification-sw.js')),false,'legacy admin/notification-sw.js must not return');

  const pushClient=read('admin/push-client.js');
  const serviceWorker=read('a4print-hub-sw.js');

  assert.match(pushClient,/serviceWorker\.register\('\/a4print-hub-sw\.js',\{scope:'\/'\}\)/,'push client must register the root HUB service worker');
  assert.match(serviceWorker,/addEventListener\('push'/,'canonical worker must handle push events');
  assert.match(serviceWorker,/addEventListener\('notificationclick'/,'canonical worker must handle notification clicks');
  assert.match(serviceWorker,/\/admin\/index\.html#hub-chat/,'chat notifications must target the integrated HUB chat');
});
