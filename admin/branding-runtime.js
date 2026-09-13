import { supabase } from './guard.js?v=20260905-netfix1';

const KEY='a4print_hub_logo';
const DEFAULT='./assets/logo_bd_transparent.svg?v=20260913-branding1';
let current='';

function cached(){
  try{return localStorage.getItem(KEY)||''}catch{return ''}
}
function store(value){
  try{if(value)localStorage.setItem(KEY,value);else localStorage.removeItem(KEY)}catch{}
}
function fallbackFor(img){
  const root=img.closest('.brand,.hub-logo-wrap');
  return root?.querySelector('#globalHubLogoFallback,.hub-logo-fallback')||null;
}
function setImage(img,source){
  if(!img)return;
  const fallback=fallbackFor(img);
  const target=source||DEFAULT;
  img.onload=()=>{img.style.removeProperty('display');if(fallback)fallback.style.display='none'};
  img.onerror=()=>{
    if(img.dataset.a4BrandFallback!=='1'){
      img.dataset.a4BrandFallback='1';
      img.src=DEFAULT;
      return;
    }
    img.style.display='none';
    if(fallback)fallback.style.display='block';
  };
  img.dataset.a4BrandFallback='0';
  if(img.getAttribute('src')!==target)img.src=target;
  else if(fallback)fallback.style.display='none';
}
function ensureBrandImage(){
  document.querySelectorAll('.sidebar .brand').forEach(brand=>{
    if(brand.querySelector('img'))return;
    const img=document.createElement('img');
    img.id='globalHubLogo';img.alt='A4PRINT HUB';
    brand.prepend(img);
  });
}
function apply(value){
  current=value||'';
  ensureBrandImage();
  const images=new Set([
    document.getElementById('hubLogo'),
    document.getElementById('globalHubLogo'),
    ...document.querySelectorAll('.sidebar .hub-logo,.sidebar .brand img')
  ].filter(Boolean));
  images.forEach(img=>setImage(img,current));
  window.dispatchEvent(new CustomEvent('a4:branding-applied',{detail:{logo:current}}));
}
async function refresh(){
  try{
    const {data,error}=await supabase.from('settings').select('value,updated_at').eq('key','hub_branding').maybeSingle();
    if(error)throw error;
    const logo=String(data?.value?.logo||'');
    store(logo);
    apply(logo);
    return logo;
  }catch(error){
    console.warn('A4PRINT HUB branding sync:',error);
    apply(cached());
    return cached();
  }
}
function watchSettingsSave(){
  if(!/\/admin\/settings\.html$/.test(location.pathname))return;
  document.addEventListener('click',event=>{
    const button=event.target?.closest?.('#save,#reset');
    if(!button)return;
    const before=cached();let tries=0;
    const timer=setInterval(()=>{
      const next=cached();tries++;
      if(next!==before||tries>=30){clearInterval(timer);apply(next);if(tries>=30)refresh().catch(()=>{})}
    },100);
  },true);
}

window.A4HubBranding={apply,refresh,get:()=>current||cached(),defaultLogo:DEFAULT};
apply(cached());
watchSettingsSave();
window.addEventListener('storage',event=>{if(event.key===KEY)apply(event.newValue||'')});
window.addEventListener('a4:branding-changed',event=>{const logo=String(event.detail?.logo||'');store(logo);apply(logo)});

// Navigation is injected dynamically on many pages. Re-apply once it has had
// a chance to build the sidebar, then sync the authoritative value from HUB.
setTimeout(()=>apply(cached()),0);
setTimeout(()=>apply(cached()),250);
refresh().catch(()=>{});
