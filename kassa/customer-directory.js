(()=>{
  'use strict';
  if(window.__A4_KASSA_CUSTOMER_DIRECTORY__)return;
  window.__A4_KASSA_CUSTOMER_DIRECTORY__=true;
  const cfg=window.A4PRINT_CONFIG||{};
  const API=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
  const create=window.supabase?.createClient;
  if(!create||!API)return;
  const supabase=create(cfg.supabaseUrl,cfg.supabasePublishableKey,{global:{fetch:window.A4SupabaseFetch||fetch},auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  let loading=false,timer=null;

  async function token(){const {data,error}=await supabase.auth.getSession();if(error)throw error;const t=data?.session?.access_token;if(!t)throw new Error('AUTH_REQUIRED');return t}
  async function fetchCustomers(q=''){
    const t=await token();
    const r=await fetch(`${API}/api/v1/pos/customer-directory?q=${encodeURIComponent(q)}`,{cache:'no-store',headers:{Authorization:`Bearer ${t}`,Accept:'application/json'}});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.message||d.error||`HTTP ${r.status}`);
    return Array.isArray(d.customers)?d.customers:[];
  }
  function panelOpen(){return $('customerPanel')&&!$('customerPanel').hidden}
  function label(c){return c.full_name||c.company_name||c.phone||c.email||'Клиент'}
  function secondary(c){return [c.phone,c.email,c.company_name].filter(Boolean).join(' · ')}
  async function selectNative(c){
    const input=$('customerSearch');if(!input)return;
    const probe=c.phone||c.email||c.full_name||c.company_name||'';
    input.value=probe;
    input.dispatchEvent(new Event('input',{bubbles:true}));
    for(let i=0;i<8;i++){
      await new Promise(r=>setTimeout(r,90));
      const native=$('customerResults')?.querySelector(`[data-customer="${CSS.escape(c.id)}"]`);
      if(native){native.click();return}
    }
    input.value=label(c);
  }
  function render(rows,q=''){
    const box=$('customerResults');if(!box||!panelOpen())return;
    if(!rows.length){box.innerHTML='<small>Клиенты HUB не найдены</small>';return}
    box.innerHTML=`<div class="a4-customer-directory-head"><b>${q?'Результаты':'Клиенты HUB'}</b><span>${rows.length}</span></div>`+rows.map(c=>`<button type="button" class="a4-customer-directory-row" data-a4-customer="${esc(c.id)}"><b>${esc(label(c))}</b><small>${esc(secondary(c)||'Без телефона и email')}</small></button>`).join('');
    box.querySelectorAll('[data-a4-customer]').forEach(btn=>{btn.onclick=()=>{const c=rows.find(x=>x.id===btn.dataset.a4Customer);if(c)selectNative(c).catch(console.warn)}});
  }
  async function load(q=''){
    if(loading)return;loading=true;
    const box=$('customerResults');if(box&&panelOpen())box.innerHTML='<small>Загрузка клиентов HUB…</small>';
    try{render(await fetchCustomers(q),q)}catch(error){if(box&&panelOpen())box.innerHTML=`<small>Не удалось загрузить клиентов: ${esc(error?.message||error)}</small>`}finally{loading=false}
  }
  function install(){
    const toggle=$('customerToggle'),input=$('customerSearch');
    if(toggle&&!toggle.dataset.a4Directory){toggle.dataset.a4Directory='1';toggle.addEventListener('click',()=>setTimeout(()=>{if(panelOpen()&&!String(input?.value||'').trim())load('')},40))}
    if(input&&!input.dataset.a4Directory){input.dataset.a4Directory='1';input.addEventListener('input',()=>{clearTimeout(timer);const q=input.value.trim();timer=setTimeout(()=>{if(panelOpen())load(q)},380)})}
    if(!document.getElementById('a4CustomerDirectoryStyle')){
      const s=document.createElement('style');s.id='a4CustomerDirectoryStyle';s.textContent=`
        .a4-customer-directory-head{display:flex;justify-content:space-between;align-items:center;padding:8px 10px 5px;font-size:12px;opacity:.72}
        .a4-customer-directory-row{width:100%;display:flex!important;flex-direction:column;align-items:flex-start!important;gap:3px;padding:10px 12px!important;text-align:left;border:0;border-bottom:1px solid rgba(15,23,42,.08);background:#fff;cursor:pointer}
        .a4-customer-directory-row:hover{background:#f4fbfc}.a4-customer-directory-row b{font-size:14px}.a4-customer-directory-row small{font-size:12px;opacity:.7;white-space:normal}
        #customerResults{max-height:320px;overflow:auto}
      `;document.head.appendChild(s)
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
  setInterval(install,2000);
})();
