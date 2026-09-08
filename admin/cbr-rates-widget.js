(()=>{
  if(window.__A4_CBR_RATES_WIDGET__)return;
  window.__A4_CBR_RATES_WIDGET__=true;

  const REFRESH_MS=10*60*1000;
  let timer=null;

  const fmt=value=>Number(value||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:4});
  const fmtTime=value=>{
    const d=new Date(value||Date.now());
    return Number.isNaN(d.getTime())?'':d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
  };
  const fmtDate=value=>{
    if(!value)return'';
    const m=String(value).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if(m)return`${m[1]}.${m[2]}.${m[3]}`;
    const d=new Date(value);
    return Number.isNaN(d.getTime())?String(value):d.toLocaleDateString('ru-RU');
  };

  function installStyles(){
    if(document.getElementById('a4-cbr-rates-style'))return;
    const s=document.createElement('style');
    s.id='a4-cbr-rates-style';
    s.textContent=`
      .a4-cbr-rates{background:#fff;border:1px solid #dfe6ef;border-radius:16px;padding:14px 16px;box-shadow:0 5px 18px rgba(15,23,42,.045)}
      .a4-cbr-rates-head{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:11px}
      .a4-cbr-rates-title{display:flex;align-items:center;gap:9px;min-width:0}
      .a4-cbr-rates-title b{font-size:14px;color:#172033}
      .a4-cbr-rates-meta{font-size:11px;color:#8190a6;white-space:nowrap}
      .a4-cbr-live{width:8px;height:8px;border-radius:50%;background:#f59e0b;box-shadow:0 0 0 4px rgba(245,158,11,.11);flex:0 0 8px}
      .a4-cbr-rates[data-state="ok"] .a4-cbr-live{background:#22c55e;box-shadow:0 0 0 4px rgba(34,197,94,.11)}
      .a4-cbr-rates[data-state="error"] .a4-cbr-live{background:#ef4444;box-shadow:0 0 0 4px rgba(239,68,68,.11)}
      .a4-cbr-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
      .a4-cbr-item{display:flex;align-items:center;gap:11px;border:1px solid #e7edf5;background:#fbfdff;border-radius:13px;padding:12px 13px;min-width:0}
      .a4-cbr-symbol{display:grid;place-items:center;width:38px;height:38px;border-radius:11px;background:#eef5ff;color:#2563eb;font-weight:900;font-size:18px;flex:0 0 38px}
      .a4-cbr-copy{min-width:0;display:flex;flex-direction:column;gap:2px}
      .a4-cbr-code{font-size:11px;font-weight:800;color:#64748b;letter-spacing:.04em}
      .a4-cbr-value{font-size:19px;line-height:1.05;font-weight:900;color:#0f172a;white-space:nowrap}
      .a4-cbr-name{font-size:11px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .a4-cbr-error{grid-column:1/-1;border:1px dashed #fecaca;background:#fff7f7;color:#b91c1c;border-radius:12px;padding:12px 13px;font-size:12px}
      @media(max-width:760px){.a4-cbr-rates{padding:12px}.a4-cbr-grid{grid-template-columns:1fr}.a4-cbr-rates-head{align-items:flex-start}.a4-cbr-rates-meta{white-space:normal;text-align:right}.a4-cbr-item{padding:11px 12px}}
    `;
    document.head.appendChild(s);
  }

  function ensureRoot(){
    let root=document.getElementById('a4CbrRates');
    if(root)return root;
    const shell=document.querySelector('.dashboard-shell');
    if(!shell)return null;
    root=document.createElement('section');
    root.id='a4CbrRates';
    root.className='a4-cbr-rates';
    root.dataset.state='loading';
    root.setAttribute('aria-label','Курсы валют Банка России');
    root.innerHTML=`
      <div class="a4-cbr-rates-head">
        <div class="a4-cbr-rates-title"><span class="a4-cbr-live"></span><b>Курсы ЦБ РФ</b></div>
        <div class="a4-cbr-rates-meta" id="a4CbrMeta">Получаем актуальный курс…</div>
      </div>
      <div class="a4-cbr-grid" id="a4CbrGrid">
        <div class="a4-cbr-item"><span class="a4-cbr-symbol">$</span><span class="a4-cbr-copy"><span class="a4-cbr-code">USD</span><strong class="a4-cbr-value">— ₽</strong><span class="a4-cbr-name">Доллар США</span></span></div>
        <div class="a4-cbr-item"><span class="a4-cbr-symbol">€</span><span class="a4-cbr-copy"><span class="a4-cbr-code">EUR</span><strong class="a4-cbr-value">— ₽</strong><span class="a4-cbr-name">Евро</span></span></div>
        <div class="a4-cbr-item"><span class="a4-cbr-symbol">¥</span><span class="a4-cbr-copy"><span class="a4-cbr-code">CNY</span><strong class="a4-cbr-value">— ₽</strong><span class="a4-cbr-name">Китайский юань</span></span></div>
      </div>`;
    const anchor=shell.querySelector('.dash-app-launcher')||shell.firstElementChild;
    if(anchor)anchor.insertAdjacentElement('beforebegin',root);else shell.prepend(root);
    return root;
  }

  async function loadRates(){
    const root=ensureRoot();if(!root)return;
    root.dataset.state='loading';
    const meta=document.getElementById('a4CbrMeta');
    if(meta)meta.textContent='Обновление…';
    try{
      const base=String(window.A4PRINT_CONFIG?.apiBaseUrl||'').replace(/\/$/,'');
      if(!base)throw new Error('API HUB не настроен');
      const response=await fetch(`${base}/api/v1/cbr/rates`,{cache:'no-store'});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok||!payload?.success)throw new Error(payload?.message||payload?.error||`HTTP ${response.status}`);
      const grid=document.getElementById('a4CbrGrid');
      const order=['USD','EUR','CNY'];
      const map=new Map((payload.rates||[]).map(x=>[x.code,x]));
      grid.innerHTML=order.map(code=>{
        const r=map.get(code);if(!r)return'';
        const nominal=Number(r.nominal||1);
        const suffix=nominal===1?'за 1':'за '+nominal;
        return `<div class="a4-cbr-item"><span class="a4-cbr-symbol">${r.symbol||''}</span><span class="a4-cbr-copy"><span class="a4-cbr-code">${code}</span><strong class="a4-cbr-value">${fmt(r.per_unit)} ₽</strong><span class="a4-cbr-name">${r.name||code} · ${suffix}</span></span></div>`;
      }).join('');
      root.dataset.state=payload.stale?'error':'ok';
      if(meta){
        const effective=fmtDate(payload.effective_date);
        const fetched=fmtTime(payload.fetched_at);
        meta.textContent=`ЦБ на ${effective||'актуальную дату'} · обновлено ${fetched||'сейчас'}${payload.stale?' · сохранённые данные':''}`;
      }
    }catch(error){
      root.dataset.state='error';
      const grid=document.getElementById('a4CbrGrid');
      if(grid)grid.innerHTML=`<div class="a4-cbr-error">Не удалось получить курс ЦБ РФ. HUB повторит запрос автоматически.</div>`;
      if(meta)meta.textContent='Связь с ЦБ временно недоступна';
      console.warn('A4 CBR rates:',error);
    }
  }

  function init(){installStyles();ensureRoot();loadRates();clearInterval(timer);timer=setInterval(loadRates,REFRESH_MS);document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadRates()});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
