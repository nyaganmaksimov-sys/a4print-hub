const params=new URLSearchParams(window.location.search);
const riskKeys=['event','entity_id','contract','claim','response','incident'];

export function riskParam(name){return String(params.get(name)||'').trim()}
export function hasRiskDeepLink(){return riskKeys.some(key=>riskParam(key))}

function ensureStyle(){
  if(document.getElementById('productionFarmDeepLinkStyle'))return;
  const s=document.createElement('style');
  s.id='productionFarmDeepLinkStyle';
  s.textContent='.pf-risk-return{display:inline-flex;align-items:center;text-decoration:none;border:1px solid #cbd5e1;border-radius:10px;padding:9px 12px;color:#0f172a;background:#fff;font-weight:800}.pf-risk-focus{outline:3px solid #2563eb!important;outline-offset:3px;box-shadow:0 0 0 5px rgba(37,99,235,.12)!important}.pf-risk-link-missing{margin:12px 0;padding:11px 13px;border-radius:10px;background:#fff7ed;color:#9a3412;border:1px solid #fed7aa;font-weight:700}';
  document.head.appendChild(s);
}

export function installRiskCockpitReturnLink(){
  if(!hasRiskDeepLink())return null;
  ensureStyle();
  let a=document.getElementById('productionFarmRiskReturn');
  if(a)return a;
  const host=document.querySelector('main .topbar > div:last-child')||document.querySelector('main .topbar');
  if(!host)return null;
  a=document.createElement('a');
  a.id='productionFarmRiskReturn';
  a.className='pf-risk-return';
  a.href='./production-farm-risk.html';
  a.textContent='← К рискам Production Farm';
  host.prepend(a);
  return a;
}

export function focusRiskElement(element){
  if(!element)return false;
  ensureStyle();
  document.querySelectorAll('.pf-risk-focus').forEach(el=>{if(el!==element)el.classList.remove('pf-risk-focus')});
  element.classList.add('pf-risk-focus');
  if(!element.hasAttribute('tabindex'))element.setAttribute('tabindex','-1');
  requestAnimationFrame(()=>{
    element.scrollIntoView({behavior:'smooth',block:'center',inline:'nearest'});
    try{element.focus({preventScroll:true})}catch{}
  });
  return true;
}

export function showRiskLinkMissing(container,message='Указанный риск уже недоступен или не найден в текущем контексте.'){
  if(!container)return;
  ensureStyle();
  let box=container.querySelector?.('.pf-risk-link-missing');
  if(!box){box=document.createElement('div');box.className='pf-risk-link-missing';container.prepend(box)}
  box.textContent=message;
}
