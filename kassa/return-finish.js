(()=>{
  'use strict';
  if(window.__A4_KASSA_RETURN_FINISH__)return;
  window.__A4_KASSA_RETURN_FINISH__=true;

  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const money=v=>Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
  const nativeFetch=window.fetch.bind(window);
  let overlay=null;
  let current=null;

  function installStyles(){
    if(document.getElementById('a4ReturnFinishStyle'))return;
    const style=document.createElement('style');style.id='a4ReturnFinishStyle';style.textContent=`
      .a4-return-finish{position:fixed;inset:0;z-index:10080;background:rgba(8,21,38,.58);display:grid;place-items:center;padding:24px}.a4-return-finish[hidden]{display:none!important}.a4-return-card{width:min(720px,96vw);max-height:88vh;overflow:auto;background:#fff;border-radius:18px;box-shadow:0 28px 80px rgba(0,0,0,.28);color:#10213a}.a4-return-head{display:flex;gap:15px;align-items:center;padding:24px 28px;border-bottom:1px solid #e5ebf1}.a4-return-icon{width:58px;height:58px;border-radius:50%;display:grid;place-items:center;background:#fff0ed;color:#d04b35;font-size:30px;font-weight:800}.a4-return-head h2{margin:0;font-size:28px}.a4-return-head p{margin:5px 0 0;color:#708097}.a4-return-body{padding:22px 28px}.a4-return-meta{display:grid;grid-template-columns:1fr 1fr;gap:12px 20px;background:#f7f9fc;border:1px solid #e1e7ef;border-radius:12px;padding:15px}.a4-return-meta span{display:block;font-size:12px;color:#8190a5;margin-bottom:4px}.a4-return-meta b{display:block;overflow-wrap:anywhere}.a4-return-items{margin-top:15px;border-top:1px solid #e6ebf1}.a4-return-item{display:flex;justify-content:space-between;gap:15px;padding:11px 0;border-bottom:1px solid #e6ebf1}.a4-return-item small{display:block;color:#758399;margin-top:3px}.a4-return-item strong{white-space:nowrap}.a4-return-total{display:flex;justify-content:space-between;align-items:center;font-size:21px;font-weight:800;margin-top:18px}.a4-return-total strong{font-size:28px;color:#bd3e2a}.a4-return-actions{display:flex;gap:12px;padding:0 28px 26px}.a4-return-actions button{flex:1;padding:14px;border-radius:11px;border:1px solid #d7e0eb;background:#fff;font:inherit;font-weight:800;cursor:pointer}.a4-return-actions .primary{background:#11aebb;border-color:#11aebb;color:#fff}@media(max-width:640px){.a4-return-meta{grid-template-columns:1fr}.a4-return-actions{flex-direction:column}}
    `;document.head.appendChild(style);
  }

  function requestInfo(body){
    const positions=[];
    document.querySelectorAll('[data-return-qty]').forEach(input=>{
      const qty=Number(input.value||0);if(!(qty>0))return;
      const row=input.closest('.return-position');positions.push({name:row?.querySelector('b')?.textContent?.trim()||'Позиция',qty});
    });
    return {
      saleLabel:String($('returnSaleLabel')?.textContent||'Продажа').replace(/^Продажа\s*/i,'').trim(),
      reason:String(body?.reason||''),
      paymentMethod:String(body?.payment_method||'Наличные'),
      account:$('returnAccount')?.selectedOptions?.[0]?.textContent?.trim()||'—',
      operator:$('operatorSelect')?.selectedOptions?.[0]?.textContent?.trim()||$('uiCashierName')?.textContent?.trim()||'Оператор',
      shift:String($('shiftInfo')?.textContent||$('footerShift')?.textContent||'').replace(/^Смена\s*/i,'').trim()||'—',
      positions
    };
  }

  function ensureUi(){
    if(overlay)return;
    installStyles();overlay=document.createElement('section');overlay.className='a4-return-finish';overlay.hidden=true;
    overlay.innerHTML=`<article class="a4-return-card" role="dialog" aria-modal="true"><div class="a4-return-head"><div class="a4-return-icon">↩</div><div><h2>Возврат проведён</h2><p id="a4ReturnFinishText">Документ сохранён в МойСклад и A4PRINT HUB.</p></div></div><div id="a4ReturnFinishBody" class="a4-return-body"></div><div class="a4-return-actions"><button id="a4ReturnPrint" type="button">Печать возврата</button><button id="a4ReturnClose" class="primary" type="button">Готово</button></div></article>`;
    document.body.appendChild(overlay);$('a4ReturnClose').onclick=()=>{overlay.hidden=true;current=null};$('a4ReturnPrint').onclick=printCurrent;
  }

  function show(result,info){
    ensureUi();current={result,info,date:new Date().toISOString()};
    const items=info.positions||[];
    $('a4ReturnFinishText').textContent=`Возврат ${result?.return?.name||''} сохранён в МойСклад и A4PRINT HUB.`;
    $('a4ReturnFinishBody').innerHTML=`<div class="a4-return-meta"><div><span>Возврат МойСклад</span><b>${esc(result?.return?.name||result?.return?.id||'—')}</b></div><div><span>Исходная продажа</span><b>${esc(info.saleLabel||'—')}</b></div><div><span>Дата и время</span><b>${new Date().toLocaleString('ru-RU')}</b></div><div><span>Оператор</span><b>${esc(info.operator)}</b></div><div><span>Способ возврата</span><b>${esc(info.paymentMethod)}</b></div><div><span>Счёт</span><b>${esc(info.account)}</b></div><div><span>Смена</span><b>${esc(info.shift)}</b></div><div><span>Причина</span><b>${esc(info.reason||'—')}</b></div></div><div class="a4-return-items">${items.map(i=>`<div class="a4-return-item"><div><b>${esc(i.name)}</b><small>Количество: ${Number(i.qty).toLocaleString('ru-RU')}</small></div></div>`).join('')||'<div class="a4-return-item"><div><b>Позиции возврата</b><small>Состав сохранён в документе МойСклад</small></div></div>'}</div><div class="a4-return-total"><span>Сумма возврата</span><strong>−${money(result?.amount)}</strong></div>`;
    overlay.hidden=false;
  }

  function printCurrent(){
    if(!current)return;const {result,info}=current;const w=window.open('','_blank','width=520,height=720');if(!w)return;
    const items=(info.positions||[]).map(i=>`<tr><td>${esc(i.name)}</td><td style="text-align:right">${Number(i.qty).toLocaleString('ru-RU')}</td></tr>`).join('');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Возврат ${esc(result?.return?.name||'')}</title><style>body{font:14px Arial,sans-serif;color:#111;margin:24px;max-width:390px}h1{font-size:20px;margin:0 0 4px}.meta{margin:14px 0;padding:10px 0;border-top:1px dashed #999;border-bottom:1px dashed #999}.meta div{display:flex;justify-content:space-between;gap:10px;margin:4px 0}table{width:100%;border-collapse:collapse}td{padding:8px 0;border-bottom:1px solid #ddd}.total{display:flex;justify-content:space-between;font-size:21px;font-weight:800;margin-top:14px}.foot{text-align:center;margin-top:18px;color:#666;font-size:12px}</style></head><body><h1>A4PRINT KASSA · ВОЗВРАТ</h1><div class="meta"><div><span>Документ</span><b>${esc(result?.return?.name||'—')}</b></div><div><span>Продажа</span><b>${esc(info.saleLabel||'—')}</b></div><div><span>Дата</span><b>${new Date(current.date).toLocaleString('ru-RU')}</b></div><div><span>Оператор</span><b>${esc(info.operator)}</b></div><div><span>Способ</span><b>${esc(info.paymentMethod)}</b></div><div><span>Причина</span><b>${esc(info.reason||'—')}</b></div></div><table>${items}</table><div class="total"><span>Возврат</span><span>−${money(result?.amount)}</span></div><div class="foot">A4PRINT HUB · МойСклад</div><script>window.onload=()=>window.print()<\/script></body></html>`);w.document.close();
  }

  function isReturnPost(input,init){
    try{const url=new URL(input instanceof Request?input.url:String(input),location.href);const method=String(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();return method==='POST'&&/\/api\/v1\/pos\/returns\/?$/.test(url.pathname)}catch{return false}
  }

  window.fetch=async function a4ReturnFinishFetch(input,init={}){
    if(!isReturnPost(input,init))return nativeFetch(input,init);
    let body={};try{body=typeof init.body==='string'?JSON.parse(init.body):{}}catch{}
    const info=requestInfo(body);
    const response=await nativeFetch(input,init);
    if(response.ok){response.clone().json().then(data=>{if(data?.success)show(data,info)}).catch(()=>{})}
    return response;
  };
})();
