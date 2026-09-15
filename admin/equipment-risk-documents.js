import {supabase} from './guard.js?v=20260905-netfix1';

if(!window.__A4_EQUIPMENT_RISK_DOCUMENTS__){
  window.__A4_EQUIPMENT_RISK_DOCUMENTS__=true;
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const fmtDate=v=>v?new Date(v).toLocaleDateString('ru-RU'):'—';
  const fmtSize=n=>{const v=Number(n||0);if(v<1024)return`${v} Б`;if(v<1048576)return`${(v/1024).toFixed(1)} КБ`;return`${(v/1048576).toFixed(1)} МБ`};
  const state={permissions:[],policies:[],improvements:[],documents:[],loading:false};
  const can=code=>state.permissions.includes(code);
  const byId=(type,id)=>type==='INSURANCE'?state.policies.find(x=>x.id===id):state.improvements.find(x=>x.id===id);
  const entityLabel=(type,row)=>type==='INSURANCE'?`Полис ${row?.policy_number||'—'} · ${row?.insurer||''}`:(row?.title||'Улучшение');
  const cleanName=name=>String(name||'file').replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]+/g,'_').slice(-120);

  function ensureUi(){
    if(!document.getElementById('riskDocumentsBtn')){
      const actions=document.querySelector('.topbar .eq-actions');
      if(actions){const b=document.createElement('button');b.id='riskDocumentsBtn';b.className='rd-btn';b.type='button';b.textContent='📎 Документы техники';b.addEventListener('click',open);actions.insertBefore(b,document.getElementById('refresh')||null)}
    }
    if(!document.getElementById('riskDocumentsDlg')){
      const d=document.createElement('dialog');d.id='riskDocumentsDlg';d.className='rd-dialog';d.innerHTML=`<div class="rd-shell"><header class="rd-head"><div><h2>📎 Документы страховок и улучшений</h2><p>Файлы хранятся в приватном архиве HUB и связаны с карточкой оборудования.</p></div><div class="rd-actions"><button id="rdRefresh" type="button">↻ Обновить</button><button id="rdUpload" class="primary" type="button">+ Прикрепить файл</button><button id="rdClose" class="rd-close" type="button">×</button></div></header><div class="rd-body"><div id="rdError" class="rd-error"></div><section id="rdKpis" class="rd-kpis"></section><div class="rd-toolbar"><input id="rdSearch" type="search" placeholder="Файл, полис, модернизация…"><select id="rdType"><option value="">Все типы</option><option value="EQUIPMENT_INSURANCE_POLICY">Страховые полисы</option><option value="EQUIPMENT_IMPROVEMENT">Улучшения</option></select><select id="rdStatus"><option value="">Все документы</option><option value="ACTIVE">Активные</option><option value="ARCHIVED">Архив</option></select><button id="rdClear" type="button">Сбросить</button></div><div id="rdList" class="rd-list"><div class="rd-empty">Загрузка…</div></div></div></div>`;document.body.appendChild(d);
      document.getElementById('rdClose').addEventListener('click',()=>d.close());
      document.getElementById('rdRefresh').addEventListener('click',load);
      document.getElementById('rdUpload').addEventListener('click',openUpload);
      for(const id of ['rdSearch','rdType','rdStatus'])document.getElementById(id).addEventListener(id==='rdSearch'?'input':'change',render);
      document.getElementById('rdClear').addEventListener('click',()=>{document.getElementById('rdSearch').value='';document.getElementById('rdType').value='';document.getElementById('rdStatus').value='';render()});
      document.getElementById('rdList').addEventListener('click',handleAction);
    }
    if(!document.getElementById('riskDocumentUploadDlg')){
      const d=document.createElement('dialog');d.id='riskDocumentUploadDlg';d.className='rd-form-dialog';d.innerHTML=`<form id="rdUploadForm"><div class="rd-form-head"><div><h3>Прикрепить документ</h3><p>PDF, изображения, Word или Excel · до 50 МБ</p></div><button type="button" id="rdUploadClose">×</button></div><div class="rd-form-body"><div class="rd-form"><label class="rd-field"><span>Раздел *</span><select id="rdEntityType"><option value="INSURANCE">Страховой полис</option><option value="IMPROVEMENT">Улучшение</option></select></label><label class="rd-field"><span>Запись *</span><select id="rdEntity" required></select></label><label class="rd-field full"><span>Файл *</span><input id="rdFile" type="file" required accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"></label><label class="rd-field full"><span>Комментарий</span><textarea id="rdNotes" rows="3" placeholder="Что это за документ"></textarea></label><div class="rd-field full"><span class="rd-hint">Файл сначала загружается в приватный Storage, после чего одной RPC-командой регистрируется в общем архиве documents/document_versions/document_links.</span></div></div><div id="rdUploadError" class="rd-error"></div></div><div class="rd-form-foot"><button id="rdUploadCancel" type="button">Отмена</button><button id="rdUploadSubmit" class="primary" type="submit">Загрузить</button></div></form>`;document.body.appendChild(d);
      document.getElementById('rdUploadClose').addEventListener('click',()=>d.close());document.getElementById('rdUploadCancel').addEventListener('click',()=>d.close());document.getElementById('rdEntityType').addEventListener('change',fillEntities);document.getElementById('rdUploadForm').addEventListener('submit',uploadDocument);
    }
  }

  async function open(){ensureUi();document.getElementById('riskDocumentsDlg').showModal();await load()}
  async function load(){
    if(state.loading)return;state.loading=true;document.getElementById('rdError').textContent='';
    try{
      const [perm,pol,imp,docs]=await Promise.all([
        supabase.rpc('get_my_permissions'),
        supabase.from('equipment_insurance_policies').select('id,equipment_id,policy_number,insurer,valid_until,status').order('valid_until',{ascending:false}),
        supabase.from('equipment_improvements').select('id,equipment_id,title,completed_on,improvement_type').order('completed_on',{ascending:false}),
        supabase.rpc('get_equipment_risk_documents')
      ]);
      for(const r of [perm,pol,imp,docs])if(r.error)throw r.error;
      state.permissions=Array.isArray(perm.data)?perm.data:[];state.policies=pol.data||[];state.improvements=imp.data||[];state.documents=docs.data||[];render();
    }catch(e){document.getElementById('rdError').textContent=e?.message||'Не удалось загрузить документы'}finally{state.loading=false}
  }
  function render(){
    const q=(document.getElementById('rdSearch')?.value||'').trim().toLowerCase(),type=document.getElementById('rdType')?.value||'',status=document.getElementById('rdStatus')?.value||'';
    const rows=state.documents.filter(d=>(!type||d.entity_type===type)&&(!status||d.document_status===status)&&(!q||`${d.file_name} ${d.title} ${d.document_number}`.toLowerCase().includes(q)));
    const linked=new Set(state.documents.map(d=>`${d.entity_type}:${d.entity_id}`));
    document.getElementById('rdKpis').innerHTML=`<article><span>Файлов</span><strong>${state.documents.length}</strong><small>в архиве техники</small></article><article><span>Полисы с файлами</span><strong>${state.policies.filter(p=>linked.has(`EQUIPMENT_INSURANCE_POLICY:${p.id}`)).length}/${state.policies.length}</strong><small>страховые документы</small></article><article><span>Улучшения с файлами</span><strong>${state.improvements.filter(i=>linked.has(`EQUIPMENT_IMPROVEMENT:${i.id}`)).length}/${state.improvements.length}</strong><small>акты, счета, фото</small></article><article><span>Приватный Storage</span><strong>50 МБ</strong><small>лимит одного файла</small></article>`;
    document.getElementById('rdUpload').hidden=!can('equipment.manage');
    document.getElementById('rdList').innerHTML=rows.map(d=>{const kind=d.entity_type==='EQUIPMENT_INSURANCE_POLICY'?'INSURANCE':'IMPROVEMENT',entity=byId(kind,d.entity_id);return `<article class="rd-card"><div class="rd-card-head"><div><h3>${esc(d.file_name||d.title)}</h3><p>${esc(entityLabel(kind,entity))}</p></div><span class="rd-pill">${d.entity_type==='EQUIPMENT_INSURANCE_POLICY'?'СТРАХОВКА':'УЛУЧШЕНИЕ'}</span></div><small>${fmtDate(d.document_date)} · ${fmtSize(d.file_size)} · ${esc(d.mime_type||'файл')} · ${esc(d.document_status)}</small>${d.notes?`<p>${esc(d.notes)}</p>`:''}<div class="rd-card-actions">${d.storage_path?`<button data-rd-open="${esc(d.storage_path)}" type="button">Открыть файл</button>`:''}</div></article>`}).join('')||'<div class="rd-empty">По выбранным условиям документов нет.</div>';
  }
  function openUpload(){if(!can('equipment.manage'))return;document.getElementById('rdUploadForm').reset();document.getElementById('rdUploadError').textContent='';fillEntities();document.getElementById('riskDocumentUploadDlg').showModal()}
  function fillEntities(){const type=document.getElementById('rdEntityType').value,rows=type==='INSURANCE'?state.policies:state.improvements;document.getElementById('rdEntity').innerHTML=rows.map(x=>`<option value="${x.id}">${esc(entityLabel(type,x))}</option>`).join('')||'<option value="">Нет доступных записей</option>'}
  async function uploadDocument(e){
    e.preventDefault();const btn=document.getElementById('rdUploadSubmit');btn.disabled=true;document.getElementById('rdUploadError').textContent='';let path='';
    try{
      const type=document.getElementById('rdEntityType').value,entityId=document.getElementById('rdEntity').value,file=document.getElementById('rdFile').files?.[0],notes=document.getElementById('rdNotes').value.trim()||null;
      if(!entityId)throw new Error('Выберите запись');if(!file)throw new Error('Выберите файл');if(file.size<=0||file.size>52428800)throw new Error('Размер файла должен быть от 1 байта до 50 МБ');
      path=`equipment-risk/${type.toLowerCase()}/${entityId}/${Date.now()}-${cleanName(file.name)}`;
      const up=await supabase.storage.from('hub-documents').upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false});if(up.error)throw up.error;
      const reg=await supabase.rpc('register_equipment_risk_document',{p_entity_type:type,p_entity_id:entityId,p_file_name:file.name,p_mime_type:file.type||null,p_file_size:file.size,p_storage_path:path,p_notes:notes});
      if(reg.error){await supabase.storage.from('hub-documents').remove([path]);throw reg.error}
      document.getElementById('riskDocumentUploadDlg').close();await load();
    }catch(err){document.getElementById('rdUploadError').textContent=err?.message||'Ошибка загрузки'}finally{btn.disabled=false}
  }
  async function handleAction(e){const b=e.target.closest('[data-rd-open]');if(!b)return;try{const r=await supabase.storage.from('hub-documents').createSignedUrl(b.dataset.rdOpen,300);if(r.error)throw r.error;const url=window.A4StorageProxyUrl?window.A4StorageProxyUrl(r.data.signedUrl):r.data.signedUrl;window.open(url,'_blank','noopener')}catch(err){document.getElementById('rdError').textContent=err?.message||'Не удалось открыть файл'}}
  const boot=()=>ensureUi();if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
}
