(()=>{
  if(window.__A4_PARTNER_INVITES_UI__)return;
  window.__A4_PARTNER_INVITES_UI__=true;

  const cfg=window.A4PRINT_CONFIG||{};
  const apiBase=String(cfg.apiBaseUrl||'').replace(/\/$/,'');
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmtDate=value=>{
    if(!value)return'без срока';
    const d=new Date(value);
    return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short'}).format(d):'—';
  };

  let supabase=null;
  let card=null;
  let listEl=null;
  let statusEl=null;
  let createBtn=null;

  function addStyles(){
    if(document.getElementById('a4-partner-invite-styles'))return;
    const style=document.createElement('style');
    style.id='a4-partner-invite-styles';
    style.textContent=`
      .partner-invite-card{position:relative}
      .partner-invite-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:16px}
      .partner-invite-head h2{margin:0 0 5px;font-size:24px}
      .partner-invite-form{display:grid;grid-template-columns:1.35fr .7fr .7fr;gap:10px;margin:14px 0 18px}
      .partner-invite-form label{display:grid;gap:6px;color:#64748b;font-size:12px;font-weight:700}
      .partner-invite-form input{width:100%;box-sizing:border-box;border:1px solid #dbe3ee;border-radius:10px;padding:10px 11px;background:#fff;color:#0f172a;font:inherit}
      .partner-invite-form .invite-wide{grid-column:1/-1}
      .partner-invite-form .invite-actions{display:flex;gap:9px;align-items:center;grid-column:1/-1}
      .partner-invite-form .invite-actions button{margin:0}
      .partner-invite-list{display:grid;gap:12px}
      .partner-invite-row{border:1px solid #e5ebf3;border-radius:14px;padding:13px;background:#fbfdff}
      .partner-invite-row-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
      .partner-invite-title{font-size:15px;font-weight:850;color:#0f172a}
      .partner-invite-meta{font-size:12px;color:#64748b;margin-top:3px;line-height:1.45}
      .partner-invite-badge{display:inline-flex;align-items:center;gap:5px;padding:5px 8px;border-radius:999px;font-size:11px;font-weight:850;background:#eafbf1;color:#15803d;white-space:nowrap}
      .partner-invite-badge.off{background:#fef2f2;color:#b91c1c}
      .partner-invite-url{display:grid;grid-template-columns:1fr auto auto;gap:7px;margin-top:10px}
      .partner-invite-url input{min-width:0;border:1px solid #dbe3ee;border-radius:9px;padding:9px 10px;background:#fff;color:#475569;font:inherit;font-size:12px}
      .partner-invite-url button,.partner-invite-row button{margin:0}
      .partner-invite-stats{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px;font-size:12px;color:#64748b}
      .partner-invite-stat{padding:5px 8px;border-radius:999px;background:#eef4ff;color:#315a9b;font-weight:700}
      .partner-invite-uses{margin-top:10px;border-top:1px solid #e8edf4;padding-top:8px}
      .partner-invite-use{display:flex;justify-content:space-between;gap:10px;padding:6px 0;font-size:12px;color:#475569}
      .partner-invite-empty{padding:18px;text-align:center;color:#94a3b8;border:1px dashed #dbe3ee;border-radius:12px}
      .partner-invite-status{font-size:12px;min-height:18px;color:#64748b}
      .partner-invite-status.ok{color:#15803d;font-weight:750}.partner-invite-status.error{color:#b91c1c;font-weight:750}
      @media(max-width:780px){.partner-invite-form{grid-template-columns:1fr 1fr}.partner-invite-form label:first-child{grid-column:1/-1}.partner-invite-url{grid-template-columns:1fr 1fr}.partner-invite-url input{grid-column:1/-1}}
      @media(max-width:520px){.partner-invite-form{grid-template-columns:1fr}.partner-invite-form label,.partner-invite-form label:first-child{grid-column:auto}.partner-invite-row-top{flex-direction:column}.partner-invite-url{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function setStatus(text,type=''){
    if(!statusEl)return;
    statusEl.textContent=text||'';
    statusEl.className=`partner-invite-status ${type}`.trim();
  }

  async function token(){
    if(!supabase){const mod=await import('./guard.js');supabase=mod.supabase}
    const {data:{session}}=await supabase.auth.getSession();
    return session?.access_token||'';
  }

  async function api(path,opt={}){
    const bearer=await token();
    const response=await fetch(`${apiBase}${path}`,{
      ...opt,
      cache:'no-store',
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${bearer}`,...(opt.headers||{})}
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.message||data.error||`HTTP ${response.status}`);
    return data;
  }

  async function copyText(text,button){
    try{
      if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(text);
      else{
        const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();
      }
      const old=button.textContent;button.textContent='Скопировано ✓';setTimeout(()=>button.textContent=old,1400);
    }catch{setStatus('Не удалось скопировать ссылку. Выделите её вручную.','error')}
  }

  function stateView(invite){
    const state=invite.state||{};
    if(state.valid)return{label:'Активна',cls:''};
    const labels={INVITE_DISABLED:'Отключена',INVITE_EXPIRED:'Срок истёк',INVITE_LIMIT_REACHED:'Лимит исчерпан'};
    return{label:labels[state.reason]||'Недоступна',cls:'off'};
  }

  function render(invites){
    if(!listEl)return;
    if(!invites.length){listEl.innerHTML='<div class="partner-invite-empty">Ссылок пока нет. Создайте первую ссылку для регистрации партнёра.</div>';return}
    listEl.innerHTML=invites.map(invite=>{
      const state=stateView(invite);
      const uses=Array.isArray(invite.registrations)?invite.registrations:[];
      return `<div class="partner-invite-row" data-invite-id="${esc(invite.id)}">
        <div class="partner-invite-row-top">
          <div>
            <div class="partner-invite-title">${esc(invite.label||'Партнёрская регистрация')}</div>
            <div class="partner-invite-meta">Создана ${esc(fmtDate(invite.created_at))} · действует до ${esc(fmtDate(invite.expires_at))}</div>
          </div>
          <span class="partner-invite-badge ${state.cls}">${state.label}</span>
        </div>
        <div class="partner-invite-url">
          <input readonly value="${esc(invite.registration_url||'')}">
          <button type="button" data-copy>Копировать</button>
          <button type="button" data-open>Открыть ↗</button>
        </div>
        <div class="partner-invite-stats">
          <span class="partner-invite-stat">Регистраций: ${Number(invite.used_count||0)} / ${Number(invite.max_uses||1)}</span>
          <span class="partner-invite-stat">Скидка: ${Number(invite.default_discount_percent||0)}%</span>
          <span class="partner-invite-stat">Отсрочка: ${Number(invite.default_payment_terms_days||0)} дн.</span>
          <button type="button" data-toggle>${invite.is_active?'Отключить':'Включить'}</button>
        </div>
        ${uses.length?`<div class="partner-invite-uses">${uses.slice(0,8).map(use=>`<div class="partner-invite-use"><span><b>${esc(use.company_name||'Партнёр')}</b> · ${esc(use.registered_email||'')}</span><span>${esc(fmtDate(use.registered_at))}</span></div>`).join('')}</div>`:''}
      </div>`;
    }).join('');

    listEl.querySelectorAll('.partner-invite-row').forEach(row=>{
      const invite=invites.find(x=>x.id===row.dataset.inviteId);
      row.querySelector('[data-copy]').onclick=e=>copyText(invite.registration_url,e.currentTarget);
      row.querySelector('[data-open]').onclick=()=>window.open(invite.registration_url,'_blank','noopener');
      row.querySelector('[data-toggle]').onclick=async e=>{
        const btn=e.currentTarget;btn.disabled=true;
        try{await api(`/api/v1/partner-invites/${encodeURIComponent(invite.id)}`,{method:'PATCH',body:JSON.stringify({is_active:!invite.is_active})});await load()}
        catch(error){setStatus(error.message,'error')}
        finally{btn.disabled=false}
      };
    });
  }

  async function load(){
    try{
      setStatus('Загрузка ссылок…');
      const result=await api('/api/v1/partner-invites');
      render(result.invites||[]);
      setStatus('');
    }catch(error){
      if(listEl)listEl.innerHTML='<div class="partner-invite-empty">Не удалось загрузить партнёрские ссылки.</div>';
      setStatus(error.message,'error');
    }
  }

  async function createInvite(event){
    event.preventDefault();
    const form=event.currentTarget;
    const fd=new FormData(form);
    createBtn.disabled=true;
    setStatus('Создаю защищённую ссылку…');
    try{
      const result=await api('/api/v1/partner-invites',{method:'POST',body:JSON.stringify({
        label:String(fd.get('label')||'').trim(),
        expires_days:Number(fd.get('expires_days')||30),
        max_uses:Number(fd.get('max_uses')||1),
        discount_percent:Number(fd.get('discount_percent')||0),
        payment_terms_days:Number(fd.get('payment_terms_days')||0)
      })});
      setStatus('Ссылка создана и готова к отправке партнёру.','ok');
      await load();
      const first=listEl?.querySelector('.partner-invite-row [data-copy]');
      if(first&&result.invite?.registration_url)copyText(result.invite.registration_url,first);
    }catch(error){setStatus(error.message,'error')}
    finally{createBtn.disabled=false}
  }

  function mount(){
    if(document.querySelector('.partner-invite-card'))return;
    const right=document.querySelector('.grid > div:nth-child(2)');
    if(!right)return;
    addStyles();
    card=document.createElement('article');
    card.className='card partner-invite-card';
    card.dataset.workspaceKey='partner-invites';
    card.innerHTML=`
      <div class="partner-invite-head">
        <div><h2>🔗 Партнёрские ссылки</h2><div class="small">Создайте защищённую ссылку, по которой новый партнёр сам зарегистрирует компанию и доступ в Partner CRM.</div></div>
      </div>
      <form class="partner-invite-form" id="partnerInviteForm">
        <label>Название ссылки<input name="label" placeholder="Например: Новый партнёр · сентябрь"></label>
        <label>Срок, дней<input name="expires_days" type="number" min="1" max="3650" value="30" required></label>
        <label>Регистраций<input name="max_uses" type="number" min="1" max="1000" value="1" required></label>
        <label>Скидка, %<input name="discount_percent" type="number" min="0" max="100" step="0.01" value="0"></label>
        <label>Отсрочка, дней<input name="payment_terms_days" type="number" min="0" max="3650" value="0"></label>
        <div class="invite-actions"><button type="submit" id="createPartnerInvite">+ Создать ссылку</button><span class="partner-invite-status" id="partnerInviteStatus"></span></div>
      </form>
      <div class="partner-invite-list" id="partnerInviteList"><div class="partner-invite-empty">Загрузка…</div></div>`;
    const first=right.querySelector('article.card');
    if(first)right.insertBefore(card,first);else right.prepend(card);
    listEl=card.querySelector('#partnerInviteList');
    statusEl=card.querySelector('#partnerInviteStatus');
    createBtn=card.querySelector('#createPartnerInvite');
    card.querySelector('#partnerInviteForm').addEventListener('submit',createInvite);
    load();
  }

  if(document.readyState==='complete')setTimeout(mount,80);
  else window.addEventListener('load',()=>setTimeout(mount,80),{once:true});
})();
