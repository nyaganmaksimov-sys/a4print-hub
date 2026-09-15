import {supabase} from './guard.js?v=20260905-netfix1';

if(!window.__A4_EQUIPMENT_RISK_ASSETS__){
  window.__A4_EQUIPMENT_RISK_ASSETS__=true;
  const $=s=>document.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const money=v=>Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:0})+' ₽';
  const date=v=>v?new Date(v+'T00:00:00').toLocaleDateString('ru-RU'):'—';
  const today=()=>new Date().toISOString().slice(0,10);
  let permissions=[],assets=[],overview=[],policies=[],improvements=[],channel=null,reloadTimer=null;
  const canManage=()=>permissions.includes('equipment.manage');
  const assetName=id=>{const a=assets.find(x=>x.id===id);return a?`${a.inventory_number||'—'} · ${a.name}`:'Оборудование'};

  function ensureUi(){
    const shell=$('.eq-shell');if(!shell)return null;
    if(!$('#equipmentRiskAssets')){
      const root=document.createElement('section');root.id='equipmentRiskAssets';root.className='eq-card risk-card';
      root.innerHTML=`<div class="eq-head risk-head"><div><h2>🛡 Страхование и улучшения</h2><p>Полисы, сроки покрытия, модернизации и вложения в ресурс оборудования.</p></div><div class="eq-actions"><button id="riskRefresh" type="button">↻ Обновить</button><button id="riskAddImprovement" class="green" type="button">+ Улучшение</button><button id="riskAddPolicy" class="primary" type="button">+ Полис</button></div></div><div id="riskKpis" class="risk-kpis"><div class="risk-empty">Загрузка…</div></div><div class="risk-layout"><div class="risk-panel"><div class="risk-panel-head"><b>Страхование</b><span class="eq-muted">активные и последние полисы</span></div><div id="riskPolicies" class="risk-list"></div></div><div class="risk-panel"><div class="risk-panel-head"><b>Улучшения и модернизации</b><span class="eq-muted">затраты и прирост стоимости</span></div><div id="riskImprovements" class="risk-list"></div></div></div>`;
      const tabs=shell.querySelector('.eq-tabs');tabs?shell.insertBefore(root,tabs):shell.appendChild(root);
      $('#riskRefresh')?.addEventListener('click',load);
      $('#riskAddPolicy')?.addEventListener('click',()=>openPolicy());
      $('#riskAddImprovement')?.addEventListener('click',()=>openImprovement());
    }
    if(!$('#riskPolicyDlg')){
      const d=document.createElement('dialog');d.id='riskPolicyDlg';d.className='eq-dialog risk-dialog';d.innerHTML=`<form id="riskPolicyForm"><div class="eq-dialog-head"><div><h2>Страховой полис</h2><p>Фиксируем покрытие и дату окончания — система сама напомнит.</p></div><button class="eq-close" type="button" data-risk-close="riskPolicyDlg">×</button></div><div class="eq-dialog-body"><input id="riskPolicyId" type="hidden"><div class="risk-form"><label class="risk-field full"><span>Оборудование *</span><select id="riskPolicyEquipment" required></select></label><label class="risk-field"><span>Страховщик *</span><input id="riskInsurer" required></label><label class="risk-field"><span>Номер полиса *</span><input id="riskPolicyNumber" required></label><label class="risk-field"><span>Действует с *</span><input id="riskValidFrom" type="date" required></label><label class="risk-field"><span>Действует до *</span><input id="riskValidUntil" type="date" required></label><label class="risk-field"><span>Страховая сумма, ₽</span><input id="riskCoverage" type="number" min="0" step="0.01"></label><label class="risk-field"><span>Премия, ₽</span><input id="riskPremium" type="number" min="0" step="0.01"></label><label class="risk-field"><span>Статус</span><select id="riskPolicyStatus"><option value="ACTIVE">Активен</option><option value="DRAFT">Черновик</option><option value="CLAIM">Страховой случай</option><option value="CANCELLED">Отменён</option><option value="EXPIRED">Истёк</option></select></label><label class="risk-field full"><span>Комментарий</span><textarea id="riskPolicyNotes" rows="3"></textarea></label></div><div id="riskPolicyError" class="eq-msg error"></div></div><div class="eq-dialog-foot"><button type="button" data-risk-close="riskPolicyDlg">Отмена</button><button class="primary" type="submit">Сохранить</button></div></form>`;document.body.appendChild(d);$('#riskPolicyForm').addEventListener('submit',savePolicy);
    }
    if(!$('#riskImprovementDlg')){
      const d=document.createElement('dialog');d.id='riskImprovementDlg';d.className='eq-dialog risk-dialog';d.innerHTML=`<form id="riskImprovementForm"><div class="eq-dialog-head"><div><h2>Улучшение оборудования</h2><p>Отдельно от ремонта: что изменили, сколько вложили и какой эффект получили.</p></div><button class="eq-close" type="button" data-risk-close="riskImprovementDlg">×</button></div><div class="eq-dialog-body"><input id="riskImprovementId" type="hidden"><div class="risk-form"><label class="risk-field full"><span>Оборудование *</span><select id="riskImprovementEquipment" required></select></label><label class="risk-field"><span>Тип</span><select id="riskImprovementType"><option value="UPGRADE">Модернизация</option><option value="REPAIR_UPGRADE">Ремонт + улучшение</option><option value="SAFETY">Безопасность</option><option value="SOFTWARE">ПО</option><option value="ACCESSORY">Оснастка / аксессуар</option><option value="OTHER">Другое</option></select></label><label class="risk-field"><span>Дата *</span><input id="riskImprovementDate" type="date" required></label><label class="risk-field full"><span>Название *</span><input id="riskImprovementTitle" required></label><label class="risk-field full"><span>Описание</span><textarea id="riskImprovementDescription" rows="3"></textarea></label><label class="risk-field"><span>Стоимость, ₽</span><input id="riskImprovementCost" type="number" min="0" step="0.01" value="0"></label><label class="risk-field"><span>Оценка прироста стоимости, ₽</span><input id="riskImprovementValue" type="number" min="0" step="0.01" value="0"></label><label class="risk-field"><span>Продление ресурса, мес.</span><input id="riskImprovementLife" type="number" min="0" step="1" value="0"></label><label class="risk-field full"><span>Комментарий</span><textarea id="riskImprovementNotes" rows="3"></textarea></label></div><div id="riskImprovementError" class="eq-msg error"></div></div><div class="eq-dialog-foot"><button type="button" data-risk-close="riskImprovementDlg">Отмена</button><button class="primary" type="submit">Сохранить</button></div></form>`;document.body.appendChild(d);$('#riskImprovementForm').addEventListener('submit',saveImprovement);
    }
    document.querySelectorAll('[data-risk-close]').forEach(b=>{if(b.dataset.bound)return;b.dataset.bound='1';b.addEventListener('click',()=>document.getElementById(b.dataset.riskClose)?.close())});
    return $('#equipmentRiskAssets');
  }

  function fillAssetSelects(){
    const html='<option value="">Выберите оборудование</option>'+assets.map(a=>`<option value="${a.id}">${esc(a.inventory_number||'—')} · ${esc(a.name)}</option>`).join('');
    for(const id of ['riskPolicyEquipment','riskImprovementEquipment']){const el=document.getElementById(id);if(el)el.innerHTML=html}
  }
  function policyState(p){
    if(p.status!=='ACTIVE')return {text:p.status,cls:'muted'};
    const days=Math.ceil((new Date(p.valid_until+'T00:00:00')-new Date(today()+'T00:00:00'))/86400000);
    if(days<0)return {text:`Истёк ${Math.abs(days)} дн. назад`,cls:'danger'};
    if(days<=7)return {text:`Осталось ${days} дн.`,cls:'danger'};
    if(days<=30)return {text:`Осталось ${days} дн.`,cls:'warn'};
    return {text:'Активен',cls:'ok'};
  }
  function render(){
    ensureUi();
    const insured=overview.filter(x=>Number(x.active_policy_count||0)>0).length;
    const expiring=overview.filter(x=>Number(x.policies_expiring_30d||0)>0).length;
    const expired=overview.filter(x=>Number(x.overdue_active_policies||0)>0).length;
    const invested=overview.reduce((s,x)=>s+Number(x.improvement_cost_total||0),0);
    $('#riskKpis').innerHTML=`<article class="risk-kpi"><span>Застраховано</span><strong>${insured}/${overview.length}</strong><small>станков с активным полисом</small></article><article class="risk-kpi ${expiring?'warn':''}"><span>Истекает ≤ 30 дней</span><strong>${expiring}</strong><small>нужно продлить полис</small></article><article class="risk-kpi ${expired?'danger':''}"><span>Просроченные полисы</span><strong>${expired}</strong><small>ACTIVE, но дата уже прошла</small></article><article class="risk-kpi"><span>Вложено в улучшения</span><strong>${money(invested)}</strong><small>зафиксированные модернизации</small></article>`;
    const rows=policies.slice().sort((a,b)=>String(b.valid_until).localeCompare(String(a.valid_until))).map(p=>{const s=policyState(p);return `<div class="risk-row"><div class="risk-row-top"><div><b>${esc(assetName(p.equipment_id))}</b><small>${esc(p.insurer)} · полис ${esc(p.policy_number)} · ${date(p.valid_from)}—${date(p.valid_until)}</small><small>Покрытие ${money(p.coverage_amount)} · премия ${money(p.premium_amount)}</small></div><span class="risk-badge ${s.cls}">${esc(s.text)}</span></div>${p.notes?`<small>${esc(p.notes)}</small>`:''}${canManage()?`<div class="risk-row-actions"><button data-risk-edit-policy="${p.id}" type="button">Изменить</button></div>`:''}</div>`}).join('');
    $('#riskPolicies').innerHTML=rows||'<div class="risk-empty">Полисов пока нет</div>';
    const ups=improvements.slice().sort((a,b)=>String(b.completed_on).localeCompare(String(a.completed_on))).map(i=>`<div class="risk-row"><div class="risk-row-top"><div><b>${esc(i.title)}</b><small>${esc(assetName(i.equipment_id))} · ${date(i.completed_on)} · ${esc(i.improvement_type)}</small><small>Затраты ${money(i.cost)} · прирост стоимости ${money(i.estimated_value_increase)}${Number(i.life_extension_months||0)?` · ресурс +${Number(i.life_extension_months)} мес.`:''}</small></div></div>${i.description?`<small>${esc(i.description)}</small>`:''}${canManage()?`<div class="risk-row-actions"><button data-risk-edit-improvement="${i.id}" type="button">Изменить</button></div>`:''}</div>`).join('');
    $('#riskImprovements').innerHTML=ups||'<div class="risk-empty">Улучшений пока нет</div>';
    for(const id of ['riskAddPolicy','riskAddImprovement']){const b=document.getElementById(id);if(b)b.hidden=!canManage()}
    document.querySelectorAll('[data-risk-edit-policy]').forEach(b=>b.addEventListener('click',()=>openPolicy(b.dataset.riskEditPolicy)));
    document.querySelectorAll('[data-risk-edit-improvement]').forEach(b=>b.addEventListener('click',()=>openImprovement(b.dataset.riskEditImprovement)));
  }

  async function load(){
    try{
      ensureUi();
      const [permR,assetR,overviewR,policyR,improvementR]=await Promise.all([
        supabase.rpc('get_my_permissions'),
        supabase.from('equipment_assets').select('id,inventory_number,name,status').neq('status','WRITTEN_OFF').order('inventory_number'),
        supabase.from('equipment_risk_overview').select('*').neq('equipment_status','WRITTEN_OFF').order('inventory_number'),
        supabase.from('equipment_insurance_policies').select('*').order('valid_until',{ascending:false}),
        supabase.from('equipment_improvements').select('*').order('completed_on',{ascending:false})
      ]);
      for(const r of [permR,assetR,overviewR,policyR,improvementR])if(r.error)throw r.error;
      permissions=Array.isArray(permR.data)?permR.data:[];assets=assetR.data||[];overview=overviewR.data||[];policies=policyR.data||[];improvements=improvementR.data||[];fillAssetSelects();render();
    }catch(error){console.warn('equipment risk assets unavailable',error);ensureUi();$('#riskPolicies').innerHTML=`<div class="risk-empty">${esc(error?.message||'Ошибка загрузки')}</div>`}
  }

  function openPolicy(id){
    const p=id?policies.find(x=>x.id===id):null;fillAssetSelects();
    document.getElementById('riskPolicyId').value=p?.id||'';document.getElementById('riskPolicyEquipment').value=p?.equipment_id||'';document.getElementById('riskInsurer').value=p?.insurer||'';document.getElementById('riskPolicyNumber').value=p?.policy_number||'';document.getElementById('riskValidFrom').value=p?.valid_from||today();document.getElementById('riskValidUntil').value=p?.valid_until||'';document.getElementById('riskCoverage').value=p?.coverage_amount??'';document.getElementById('riskPremium').value=p?.premium_amount??'';document.getElementById('riskPolicyStatus').value=p?.status||'ACTIVE';document.getElementById('riskPolicyNotes').value=p?.notes||'';document.getElementById('riskPolicyError').textContent='';document.getElementById('riskPolicyDlg').showModal();
  }
  async function savePolicy(e){
    e.preventDefault();const id=document.getElementById('riskPolicyId').value;const payload={equipment_id:document.getElementById('riskPolicyEquipment').value,insurer:document.getElementById('riskInsurer').value.trim(),policy_number:document.getElementById('riskPolicyNumber').value.trim(),valid_from:document.getElementById('riskValidFrom').value,valid_until:document.getElementById('riskValidUntil').value,coverage_amount:Number(document.getElementById('riskCoverage').value||0),premium_amount:Number(document.getElementById('riskPremium').value||0),status:document.getElementById('riskPolicyStatus').value,notes:document.getElementById('riskPolicyNotes').value.trim()||null};
    const r=id?await supabase.from('equipment_insurance_policies').update(payload).eq('id',id):await supabase.from('equipment_insurance_policies').insert(payload);if(r.error){document.getElementById('riskPolicyError').textContent=r.error.message;return}document.getElementById('riskPolicyDlg').close();await load();
  }
  function openImprovement(id){
    const i=id?improvements.find(x=>x.id===id):null;fillAssetSelects();document.getElementById('riskImprovementId').value=i?.id||'';document.getElementById('riskImprovementEquipment').value=i?.equipment_id||'';document.getElementById('riskImprovementType').value=i?.improvement_type||'UPGRADE';document.getElementById('riskImprovementDate').value=i?.completed_on||today();document.getElementById('riskImprovementTitle').value=i?.title||'';document.getElementById('riskImprovementDescription').value=i?.description||'';document.getElementById('riskImprovementCost').value=i?.cost??0;document.getElementById('riskImprovementValue').value=i?.estimated_value_increase??0;document.getElementById('riskImprovementLife').value=i?.life_extension_months??0;document.getElementById('riskImprovementNotes').value=i?.notes||'';document.getElementById('riskImprovementError').textContent='';document.getElementById('riskImprovementDlg').showModal();
  }
  async function saveImprovement(e){
    e.preventDefault();const id=document.getElementById('riskImprovementId').value;const payload={equipment_id:document.getElementById('riskImprovementEquipment').value,improvement_type:document.getElementById('riskImprovementType').value,title:document.getElementById('riskImprovementTitle').value.trim(),description:document.getElementById('riskImprovementDescription').value.trim()||null,cost:Number(document.getElementById('riskImprovementCost').value||0),estimated_value_increase:Number(document.getElementById('riskImprovementValue').value||0),life_extension_months:Number(document.getElementById('riskImprovementLife').value||0),completed_on:document.getElementById('riskImprovementDate').value,notes:document.getElementById('riskImprovementNotes').value.trim()||null};
    const r=id?await supabase.from('equipment_improvements').update(payload).eq('id',id):await supabase.from('equipment_improvements').insert(payload);if(r.error){document.getElementById('riskImprovementError').textContent=r.error.message;return}document.getElementById('riskImprovementDlg').close();await load();
  }
  function realtime(){if(typeof supabase.channel!=='function')return;const reload=()=>{clearTimeout(reloadTimer);reloadTimer=setTimeout(load,500)};let ch=supabase.channel('equipment-risk-assets-v1');for(const table of ['equipment_insurance_policies','equipment_improvements','equipment_assets'])ch=ch.on('postgres_changes',{event:'*',schema:'public',table},reload);channel=ch.subscribe();window.addEventListener('beforeunload',()=>{if(channel)supabase.removeChannel(channel)},{once:true})}
  const boot=()=>{ensureUi();load();realtime()};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
}
