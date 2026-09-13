import {supabase} from './guard.js?v=20260905-netfix1';

if(!window.__A4_LEADER_EXPENSES_NAV__){
  window.__A4_LEADER_EXPENSES_NAV__=true;

  const isExpenses=/\/admin\/expenses\.html$/.test(location.pathname);
  const icon='<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h4"/><path d="M16 15v4M14 17h4"/></svg>';

  async function allowed(){
    try{
      const {data,error}=await supabase.rpc('is_hub_leader');
      if(error)throw error;
      return data===true;
    }catch(error){
      console.warn('Leader expenses access check failed',error);
      return false;
    }
  }

  function installLink(){
    const nav=document.querySelector('.sidebar nav');
    if(!nav)return false;
    if(nav.querySelector('a[href$="expenses.html"]'))return true;
    const link=document.createElement('a');
    link.href='./expenses.html';
    link.title='Расходы';
    if(isExpenses)link.classList.add('active');
    link.innerHTML=`<span class="a4-nav-icon">${icon}</span><span class="a4-nav-label">Расходы</span>`;
    const payments=nav.querySelector('a[href$="payments.html"]');
    if(payments)payments.insertAdjacentElement('afterend',link);else nav.appendChild(link);
    return true;
  }

  async function init(){
    if(!await allowed())return;
    window.__A4_IS_HUB_LEADER__=true;
    let tries=0;
    const paint=()=>{if(installLink()||++tries>80)return;setTimeout(paint,100)};
    paint();
  }

  init();
}
