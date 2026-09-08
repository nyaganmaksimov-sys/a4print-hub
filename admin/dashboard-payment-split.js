import { supabase } from './guard.js?v=20260905-netfix1';

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money = (value) => Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 });

const state = {
  cash: { salesCount: 0, salesTotal: 0, returnCount: 0, returnTotal: 0 },
  card: { salesCount: 0, salesTotal: 0, returnCount: 0, returnTotal: 0 },
  loaded: false,
  loading: false,
  channel: null
};

function dayStartIso(){
  const d = new Date();
  d.setHours(0,0,0,0);
  return d.toISOString();
}

function paymentBucket(value){
  const text = String(value || '').trim().toLowerCase();
  if(text.includes('налич') || text === 'cash') return 'cash';
  if(text.includes('карт') || text === 'card' || text.includes('безнал')) return 'card';
  return null;
}

function paymentIcon(type){
  if(type === 'card') return '<svg viewBox="0 0 24 24"><path d="M3 6h18v12H3z"></path><path d="M3 10h18M7 15h4"></path></svg>';
  return '<svg viewBox="0 0 24 24"><path d="M4 7h16v10H4z"></path><path d="M8 12h8M12 9v6"></path></svg>';
}

function rowHtml(type, data){
  const isCash = type === 'cash';
  const net = Number(data.salesTotal || 0) - Number(data.returnTotal || 0);
  const returnText = data.returnCount
    ? `возвраты ${data.returnCount} на ${money(data.returnTotal)} ₽`
    : 'возвратов нет';
  return `<a class="dash-attention-item ${data.returnCount ? 'warn' : 'good'}" href="../kassa/" data-payment-split="${type}">
    <span class="dash-attention-icon">${paymentIcon(type)}</span>
    <span class="dash-attention-copy"><b>${isCash ? 'Оплата наличными' : 'Оплата картой'}</b><span>${esc(`${data.salesCount} продаж · ${returnText} · чистыми ${money(net)} ₽`)}</span></span>
    <span class="dash-attention-count">${esc(`${money(data.salesTotal)} ₽`)}</span>
  </a>`;
}

function render(){
  const root = document.getElementById('posControlSummary');
  if(!root || !state.loaded) return;
  root.querySelectorAll('[data-payment-split]').forEach((node) => node.remove());
  const children = Array.from(root.children);
  const before = children[3] || null;
  const wrap = document.createElement('div');
  wrap.innerHTML = rowHtml('cash', state.cash) + rowHtml('card', state.card);
  const nodes = Array.from(wrap.children);
  for(const node of nodes) root.insertBefore(node, before);
}

async function load(){
  if(state.loading) return;
  state.loading = true;
  try{
    const start = dayStartIso();
    const [salesR, returnsR] = await Promise.all([
      supabase.from('pos_sales').select('total,payment_method,sold_at').gte('sold_at', start).limit(1000),
      supabase.from('pos_returns').select('amount,payment_method,returned_at').gte('returned_at', start).limit(1000)
    ]);
    if(salesR.error) throw salesR.error;
    if(returnsR.error) throw returnsR.error;
    state.cash = { salesCount:0, salesTotal:0, returnCount:0, returnTotal:0 };
    state.card = { salesCount:0, salesTotal:0, returnCount:0, returnTotal:0 };
    for(const sale of salesR.data || []){
      const bucket = paymentBucket(sale.payment_method);
      if(!bucket) continue;
      state[bucket].salesCount += 1;
      state[bucket].salesTotal += Number(sale.total || 0);
    }
    for(const ret of returnsR.data || []){
      const bucket = paymentBucket(ret.payment_method);
      if(!bucket) continue;
      state[bucket].returnCount += 1;
      state[bucket].returnTotal += Number(ret.amount || 0);
    }
    state.loaded = true;
    render();
  }catch(error){
    console.warn('Dashboard payment split unavailable', error);
  }finally{
    state.loading = false;
  }
}

const root = document.getElementById('posControlSummary');
if(root){
  const observer = new MutationObserver(() => {
    if(state.loaded && !root.querySelector('[data-payment-split="cash"]')) queueMicrotask(render);
  });
  observer.observe(root, { childList:true });
}

if(typeof supabase.channel === 'function'){
  let timer = null;
  const reload = () => {
    clearTimeout(timer);
    timer = setTimeout(load, 350);
  };
  state.channel = supabase.channel('dashboard-payment-split-v1')
    .on('postgres_changes', { event:'*', schema:'public', table:'pos_sales' }, reload)
    .on('postgres_changes', { event:'*', schema:'public', table:'pos_returns' }, reload)
    .subscribe();
  window.addEventListener('beforeunload', () => {
    if(state.channel) supabase.removeChannel(state.channel);
  }, { once:true });
}

load();
setInterval(() => { if(!document.hidden) load(); }, 60000);
