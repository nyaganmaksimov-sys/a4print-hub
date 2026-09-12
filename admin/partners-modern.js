(()=>{
  if(window.__A4_PARTNERS_MODERN__)return;
  window.__A4_PARTNERS_MODERN__=true;

  const legacyLayoutKey='a4print-partners-layout-v1';
  const clearLegacyLayout=()=>{try{localStorage.removeItem(legacyLayoutKey)}catch{}};
  clearLegacyLayout();
  window.addEventListener('pageshow',clearLegacyLayout,{passive:true});

  function installStyles(){
    if(document.getElementById('a4-partners-v2-styles'))return;
    const style=document.createElement('style');
    style.id='a4-partners-v2-styles';
    style.textContent=`
      body.partners-modern .main{max-width:none!important}
      body.partners-modern .main>.topbar{margin-bottom:12px!important}
      body.partners-modern .main>.topbar h1{font-size:34px!important}
      body.partners-modern .grid{grid-template-columns:minmax(0,1.35fr) minmax(350px,.65fr)!important;gap:14px!important}
      body.partners-modern .card{padding:17px!important;border-radius:18px!important;box-shadow:0 5px 18px rgba(31,52,79,.04)!important}
      #resetLayout,.drag-handle{display:none!important}

      .partners-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:0 0 14px}
      .partners-summary-item{min-width:0;padding:12px 14px;border:1px solid #e0e8f2;border-radius:15px;background:#fff;box-shadow:0 4px 14px rgba(31,52,79,.035)}
      .partners-summary-label{display:block;margin-bottom:4px;color:#7b8ba1;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.045em}
      .partners-summary-value{display:block;color:#0f172a;font-size:23px;line-height:1;font-weight:900;letter-spacing:-.035em;font-variant-numeric:tabular-nums}
      .partners-summary-note{display:block;margin-top:5px;color:#94a3b8;font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .partners-summary-item.is-good .partners-summary-value{color:#16803b}
      .partners-summary-item.is-blue .partners-summary-value{color:#2563eb}

      .partners-database-card>.row:first-child{align-items:center!important;margin-bottom:10px!important}
      .partners-database-card>.row:first-child h2{margin:0!important;font-size:23px!important}
      .partners-card-kicker{margin:1px 0 0;color:#8493a8;font-size:11px;font-weight:650}
      .partners-db-head-actions{display:flex;align-items:center;gap:8px;margin-left:auto}
      .partners-db-head-actions .small{font-size:11px!important;white-space:nowrap}
      .partners-add-shortcut{height:32px!important;min-height:32px!important;padding:0 10px!important;border:1px solid #d9e6f8!important;border-radius:9px!important;background:#eef5ff!important;color:#175ac9!important;font-size:11px!important;font-weight:800!important}

      .partners-database-card .toolbar{display:grid!important;grid-template-columns:minmax(220px,1fr) 145px 165px!important;gap:8px!important;margin:0 0 10px!important}
      .partners-database-card .toolbar input,.partners-database-card .toolbar select{height:40px!important;min-height:40px!important;border:1px solid #d8e2ee!important;border-radius:11px!important;background:#fff!important;color:#334155!important;padding:0 11px!important;font:inherit!important;font-size:12px!important;outline:none!important}
      .partners-database-card .toolbar input:focus,.partners-database-card .toolbar select:focus{border-color:#7fb0ff!important;box-shadow:0 0 0 3px rgba(37,99,235,.08)!important}

      #partners{display:grid!important;gap:7px!important;margin-top:0!important}
      #partners .partner{position:relative!important;padding:12px 13px!important;border:1px solid #e6edf5!important;border-radius:13px!important;background:#fff!important;cursor:pointer!important;transition:border-color .15s ease,box-shadow .15s ease,transform .15s ease!important}
      #partners .partner:hover{border-color:#cfdceb!important;box-shadow:0 5px 14px rgba(43,67,98,.05)!important;transform:translateY(-1px)!important}
      #partners .partner:focus-visible{outline:3px solid rgba(37,99,235,.14);outline-offset:2px}
      #partners .partner .row{display:grid!important;grid-template-columns:minmax(0,1fr) 132px!important;gap:13px!important;align-items:start!important}
      #partners .partner .row>div:first-child{min-width:0!important}
      #partners .partner .row>div:first-child>b{display:block!important;margin:0 0 4px!important;color:#0f172a!important;font-size:15px!important;line-height:1.25!important;font-weight:900!important}
      #partners .partner .meta{margin-top:2px!important;color:#718198!important;font-size:11.5px!important;line-height:1.4!important;overflow-wrap:anywhere}
      #partners .partner .row>div:last-child{display:grid!important;grid-template-columns:1fr!important;gap:6px!important;min-width:0!important;align-items:stretch!important}
      #partners .partner .row>div:last-child br{display:none!important}
      #partners .partner .badge{justify-self:end!important;min-height:23px!important;padding:0 8px!important;font-size:10.5px!important}
      #partners .partner button[data-order-partner],#partners .partner button[data-toggle]{width:100%!important;min-width:0!important;height:31px!important;min-height:31px!important;margin:0!important;border-radius:9px!important;font-size:10.5px!important}
      #partners .partner button[data-order-partner]{background:#eef5ff!important;border:1px solid #d6e6ff!important;color:#175ac9!important}
      #partners .partner button[data-toggle]{background:#fff!important;border:1px solid #e2e8f0!important;color:#64748b!important}
      #partners .partner.partner-openable:after{content:'Карточка партнёра →'!important;display:block!important;margin-top:7px!important;color:#7c8fa8!important;font-size:10.5px!important;font-weight:800!important}
      #partners .partner.is-filtered-out{display:none!important}
      .partners-empty-filter{display:none;padding:20px 14px;border:1px dashed #d6e2ef;border-radius:12px;background:#fbfdff;color:#91a0b4;text-align:center;font-size:12px}
      .partners-empty-filter.is-visible{display:block}

      .partner-invite-card{background:#fff!important}
      .partner-invite-head{margin-bottom:10px!important}
      .partner-invite-head h2{margin:0 0 4px!important;font-size:22px!important}
      .partner-invite-head .small{font-size:11.5px!important;line-height:1.42!important}
      .partner-invite-form{display:grid!important;grid-template-columns:minmax(0,1fr) 110px!important;gap:9px!important;margin:0 0 12px!important}
      .partner-invite-form>label{font-size:10.5px!important}
      .partner-invite-form>label:first-child{grid-column:auto!important}
      .partner-invite-form input{height:38px!important;min-height:38px!important;padding:7px 9px!important;font-size:11.5px!important}
      .partner-invite-more{grid-column:1/-1;border:1px solid #e7edf5;border-radius:10px;background:#fbfdff;overflow:hidden}
      .partner-invite-more summary{padding:9px 11px;cursor:pointer;color:#52657d;font-size:11px;font-weight:800;list-style:none}
      .partner-invite-more summary::-webkit-details-marker{display:none}
      .partner-invite-more summary:after{content:'+';float:right;color:#8ca0b8;font-size:15px;line-height:1}
      .partner-invite-more[open] summary:after{content:'−'}
      .partner-invite-more-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:0 10px 10px}
      .partner-invite-more-grid label{display:grid;gap:4px;color:#64748b;font-size:10.5px;font-weight:750}
      .partner-invite-form .invite-actions{grid-column:1/-1!important;display:flex!important;align-items:center!important;gap:8px!important}
      #createPartnerInvite{height:34px!important;min-height:34px!important;padding:0 12px!important}
      .partner-invite-section-title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 0 8px;color:#334155;font-size:11px;font-weight:850}
      .partner-invite-section-title span:last-child{color:#94a3b8;font-weight:700}
      .partner-invite-row{padding:10px!important;border-radius:11px!important}
      .partner-invite-title{font-size:13px!important}
      .partner-invite-meta{font-size:10.5px!important}
      .partner-invite-url{grid-template-columns:minmax(0,1fr) auto!important}
      .partner-invite-url [data-open]{display:none!important}
      .partner-invite-stats{gap:4px!important}
      .partner-invite-stat{min-height:22px!important;padding:0 7px!important;font-size:9.8px!important}

      .partners-create-card,.partners-outbound-card,.partners-catalog-card{transition:box-shadow .16s ease}
      .partners-create-card.flash-focus{box-shadow:0 0 0 3px rgba(37,99,235,.11),0 8px 24px rgba(31,52,79,.06)!important}

      @media(max-width:1180px){body.partners-modern .grid{grid-template-columns:1fr!important}.partners-summary{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:760px){
        .partners-summary{grid-template-columns:1fr 1fr;gap:8px}
        .partners-summary-item{padding:10px 11px}.partners-summary-value{font-size:20px}
        .partners-database-card .toolbar{grid-template-columns:1fr!important}
        #partners .partner .row{grid-template-columns:1fr!important}
        #partners .partner .row>div:last-child{grid-template-columns:auto 1fr 1fr!important;align-items:center!important}
        #partners .partner .badge{justify-self:start!important}
        .partner-invite-form{grid-template-columns:1fr!important}.partner-invite-more-grid{grid-template-columns:1fr!important}
      }
    `;
    document.head.appendChild(style);
  }

  function partnerId(row){
    const btn=row.querySelector('[data-toggle],[data-order-partner]');
    return btn?.dataset.toggle||btn?.dataset.orderPartner||'';
  }

  function partnerOrders(row){
    const text=row.textContent||'';
    const match=text.match(/Заказов:\s*(\d+)/i);
    return match?Number(match[1]):0;
  }

  function partnerName(row){return row.querySelector('.row>div:first-child>b')?.textContent?.trim()||''}
  function partnerActive(row){return !row.querySelector('.badge.off')}

  function mountSummary(){
    const grid=document.querySelector('.grid');
    if(!grid||document.querySelector('.partners-summary'))return;
    const section=document.createElement('section');
    section.className='partners-summary';
    section.innerHTML=`
      <div class="partners-summary-item"><span class="partners-summary-label">Партнёров</span><strong class="partners-summary-value" data-partner-kpi="total">0</strong><span class="partners-summary-note">в базе HUB</span></div>
      <div class="partners-summary-item is-good"><span class="partners-summary-label">Активны</span><strong class="partners-summary-value" data-partner-kpi="active">0</strong><span class="partners-summary-note">доступ разрешён</span></div>
      <div class="partners-summary-item is-blue"><span class="partners-summary-label">Заказов</span><strong class="partners-summary-value" data-partner-kpi="orders">0</strong><span class="partners-summary-note">по партнёрам</span></div>
      <div class="partners-summary-item"><span class="partners-summary-label">Ссылки</span><strong class="partners-summary-value" data-partner-kpi="invites">0</strong><span class="partners-summary-note">активные приглашения</span></div>`;
    grid.before(section);
  }

  function updateSummary(){
    const rows=[...document.querySelectorAll('#partners .partner')];
    const set=(key,value)=>{const el=document.querySelector(`[data-partner-kpi="${key}"]`);if(el)el.textContent=String(value)};
    set('total',rows.length);
    set('active',rows.filter(partnerActive).length);
    set('orders',rows.reduce((sum,row)=>sum+partnerOrders(row),0));
    set('invites',document.querySelectorAll('.partner-invite-row .partner-invite-badge:not(.off)').length);
  }

  function ensureControls(partnerCard){
    const toolbar=partnerCard?.querySelector('.toolbar');
    if(!toolbar)return;
    if(!document.getElementById('partnerStatusFilter')){
      const status=document.createElement('select');
      status.id='partnerStatusFilter';
      status.setAttribute('aria-label','Статус партнёра');
      status.innerHTML='<option value="all">Все статусы</option><option value="active">Активные</option><option value="off">Отключённые</option>';
      toolbar.appendChild(status);
      status.addEventListener('change',applyControls);
    }
    if(!document.getElementById('partnerSort')){
      const sort=document.createElement('select');
      sort.id='partnerSort';
      sort.setAttribute('aria-label','Сортировка партнёров');
      sort.innerHTML='<option value="default">Сначала новые</option><option value="name">По названию</option><option value="orders">По заказам</option>';
      toolbar.appendChild(sort);
      sort.addEventListener('change',applyControls);
    }
    if(!document.querySelector('.partners-empty-filter')){
      const empty=document.createElement('div');
      empty.className='partners-empty-filter';
      empty.textContent='По выбранному фильтру партнёров нет.';
      partnerCard.querySelector('#partners')?.after(empty);
    }
  }

  function applyControls(){
    const list=document.getElementById('partners');
    if(!list)return;
    const status=document.getElementById('partnerStatusFilter')?.value||'all';
    const sort=document.getElementById('partnerSort')?.value||'default';
    const rows=[...list.querySelectorAll('.partner')];
    for(const row of rows){
      const active=partnerActive(row);
      const hidden=status==='active'&&!active||status==='off'&&active;
      row.classList.toggle('is-filtered-out',hidden);
    }
    let ordered=[...rows];
    if(sort==='name')ordered.sort((a,b)=>partnerName(a).localeCompare(partnerName(b),'ru'));
    if(sort==='orders')ordered.sort((a,b)=>partnerOrders(b)-partnerOrders(a)||partnerName(a).localeCompare(partnerName(b),'ru'));
    if(sort!=='default'){
      const before=rows.map(partnerId).join('|'),after=ordered.map(partnerId).join('|');
      if(before!==after)ordered.forEach(row=>list.appendChild(row));
    }
    const visible=rows.filter(row=>!row.classList.contains('is-filtered-out')).length;
    document.querySelector('.partners-empty-filter')?.classList.toggle('is-visible',visible===0&&rows.length>0);
  }

  function wirePartnerRows(){
    document.querySelectorAll('#partners .partner').forEach(row=>{
      const id=partnerId(row);
      if(!id)return;
      row.dataset.partnerId=id;
      row.dataset.partnerOrders=String(partnerOrders(row));
      row.dataset.partnerStatus=partnerActive(row)?'active':'off';
      if(row.dataset.partnerOpenable==='1')return;
      row.dataset.partnerOpenable='1';
      row.classList.add('partner-openable');
      row.tabIndex=0;
      row.setAttribute('role','link');
      row.setAttribute('aria-label',`Открыть карточку партнёра ${partnerName(row)}`);
      const open=()=>location.href=`./partner.html?id=${encodeURIComponent(id)}`;
      row.addEventListener('click',event=>{if(event.target.closest('button,a,input,textarea,select,label'))return;open()});
      row.addEventListener('keydown',event=>{
        if((event.key==='Enter'||event.key===' ')&&!event.target.closest('button,a,input,textarea,select')){event.preventDefault();open()}
      });
      const orderBtn=row.querySelector('[data-order-partner]');
      if(orderBtn)orderBtn.textContent='Заказать';
    });
  }

  function enhanceDatabase(partnerCard){
    if(!partnerCard)return;
    partnerCard.classList.add('partners-database-card');
    const header=partnerCard.querySelector('.row');
    const count=document.getElementById('count');
    if(header&&!header.querySelector('.partners-db-head-actions')){
      const actions=document.createElement('div');
      actions.className='partners-db-head-actions';
      if(count){count.remove();actions.appendChild(count)}
      const add=document.createElement('button');
      add.type='button';add.className='partners-add-shortcut';add.textContent='+ Добавить';
      add.onclick=()=>{
        const card=document.querySelector('.partners-create-card');
        if(!card)return;
        card.scrollIntoView({behavior:'smooth',block:'center'});
        card.classList.add('flash-focus');setTimeout(()=>card.classList.remove('flash-focus'),1600);
        setTimeout(()=>card.querySelector('input[name="name"]')?.focus({preventScroll:true}),450);
      };
      actions.appendChild(add);header.appendChild(actions);
    }
    ensureControls(partnerCard);
  }

  function compactInviteCard(){
    const inviteCard=document.querySelector('.partner-invite-card');
    if(!inviteCard)return;
    inviteCard.classList.add('partners-invite-card-ready');
    const title=inviteCard.querySelector('.partner-invite-head h2');
    if(title)title.textContent='🔗 Пригласить партнёра';
    const lead=inviteCard.querySelector('.partner-invite-head .small');
    if(lead)lead.textContent='Создайте защищённую ссылку — партнёр сам зарегистрирует компанию и доступ в Partner CRM.';
    const form=inviteCard.querySelector('.partner-invite-form');
    if(form&&!form.querySelector('.partner-invite-more')){
      const labels=[...form.querySelectorAll(':scope > label')];
      const extra=labels.filter(label=>['max_uses','discount_percent','payment_terms_days'].includes(label.querySelector('input')?.name));
      if(extra.length){
        const details=document.createElement('details');
        details.className='partner-invite-more';
        details.innerHTML='<summary>Дополнительные условия</summary><div class="partner-invite-more-grid"></div>';
        const grid=details.querySelector('.partner-invite-more-grid');
        extra.forEach(label=>grid.appendChild(label));
        const actions=form.querySelector('.invite-actions');
        form.insertBefore(details,actions||null);
      }
    }
    const list=inviteCard.querySelector('.partner-invite-list');
    if(list&&!inviteCard.querySelector('.partner-invite-section-title')){
      const heading=document.createElement('div');
      heading.className='partner-invite-section-title';
      heading.innerHTML='<span>Созданные ссылки</span><span>регистрация партнёров</span>';
      list.before(heading);
    }
  }

  function enhanceOtherCards(){
    const createCard=document.querySelector('#partnerForm')?.closest('article.card');
    if(createCard){
      createCard.classList.add('partners-create-card');
      const title=createCard.querySelector('h2');
      if(title&&!createCard.querySelector('.partners-card-kicker')){
        const kicker=document.createElement('div');kicker.className='partners-card-kicker';kicker.textContent='Ручное создание партнёра и доступа в Partner CRM';title.insertAdjacentElement('afterend',kicker);
      }
    }
    const outboundCard=document.querySelector('#outboundForm')?.closest('article.card');
    if(outboundCard){
      outboundCard.classList.add('partners-outbound-card');
      const title=outboundCard.querySelector('h2');
      if(title&&!outboundCard.querySelector('.partners-card-kicker')){
        const kicker=document.createElement('div');kicker.className='partners-card-kicker';kicker.textContent='Быстрый заказ услуги у выбранного исполнителя';title.insertAdjacentElement('afterend',kicker);
      }
    }
    document.querySelector('#services')?.closest('article.card')?.classList.add('partners-catalog-card');
  }

  function enhance(){
    const main=document.querySelector('.main');
    if(!main)return;
    clearLegacyLayout();
    installStyles();
    document.body.classList.add('partners-modern');
    document.getElementById('resetLayout')?.setAttribute('hidden','');
    document.querySelectorAll('.grid article.card').forEach(card=>{card.draggable=false;card.removeAttribute('draggable');card.querySelectorAll('.drag-handle').forEach(x=>x.remove())});
    mountSummary();
    const partnerCard=document.querySelector('#partners')?.closest('article.card');
    enhanceDatabase(partnerCard);
    enhanceOtherCards();
    compactInviteCard();
    wirePartnerRows();
    applyControls();
    updateSummary();
  }

  let timer=0;
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(enhance,35)};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});else schedule();
  const observer=new MutationObserver(schedule);
  const startObserver=()=>observer.observe(document.body,{childList:true,subtree:true});
  if(document.body)startObserver();else document.addEventListener('DOMContentLoaded',startObserver,{once:true});
  window.addEventListener('load',()=>setTimeout(enhance,160),{once:true});
})();
