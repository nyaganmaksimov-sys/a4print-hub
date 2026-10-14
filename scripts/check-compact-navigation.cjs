'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const read=p=>fs.readFileSync(p,'utf8');
const config=read('admin/config.js');
const nav=read('admin/compact-navigation.js');
assert.match(config,/load\('compact-navigation\.js'/,'Compact navigation must load from shared config');
assert.match(config,/load\('navigation\.js'/,'Original nav source must remain available');
assert.match(nav,/\.sidebar[\s\S]*?display:none!important/,'Sidebar must be hidden in the visual layout');
assert.match(nav,/margin-left:0!important/,'Content must expand to full width');
assert.match(nav,/a4-compact-menu-button/,'Compact navigation trigger is required');
assert.match(nav,/a4-compact-menu-panel/,'Compact navigation panel is required');
for(const page of ['index.html','orders.html','customers.html','warehouse.html','production.html','partners.html','payments.html','reports.html','documents.html','apps.html','settings.html']){
 const body=read('admin/'+page);
 assert.match(body,/config\.js/,'Shared config missing on '+page);
}
for(const label of ['Главная','Заказы','Клиенты','Склад','Производство','Партнёры','Отчёты','Настройки']){
 assert.ok(nav.includes(label),'Fallback menu missing '+label);
}
console.log('Compact navigation regression checks passed');
