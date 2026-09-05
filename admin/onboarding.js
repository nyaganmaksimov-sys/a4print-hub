(()=>{
  if(window.__A4_ONBOARDING__)return;
  window.__A4_ONBOARDING__=true;

  const forced=new URLSearchParams(location.search).get('tour')==='1';
  function currentUserId(){
    try{
      for(let i=0;i<localStorage.length;i++){
        const k=localStorage.key(i);if(!k||!/^sb-.*-auth-token$/.test(k))continue;
        const v=JSON.parse(localStorage.getItem(k)||'null');if(v?.user?.id)return v.user.id;
      }
    }catch{}
    return '';
  }
  function key(){const id=currentUserId();return `a4print_onboarding_v1_${id||'device'}`}
  const slides=[
    {icon:'👋',title:'Добро пожаловать в A4PRINT HUB',text:'Это единая рабочая система А4-Принт: заказы, клиенты, производство, склад, касса, сотрудники, сообщения, приложения и поддержка находятся в одном месте.'},
    {icon:'🧾',title:'Заказы и рабочий стол менеджера',text:'Создавайте заказ через «Менеджер», выбирайте клиента и услугу, проверяйте расчёт, затем отслеживайте заказ от нового до готового и завершённого.'},
    {icon:'💬',title:'Сообщения и поддержка',text:'В «Сообщениях» работает внутренний чат сотрудников. В новом разделе «Поддержка» есть база знаний, чат-бот и личный вызов оператора, если готового ответа недостаточно.'},
    {icon:'💳',title:'Касса и МойСклад',text:'Касса работает отдельным приложением: смены, операторы, продажи, возвраты, отчёты и синхронизация с МойСклад. Операторы управляются внутри A4PRINT HUB.'},
    {icon:'📱',title:'Приложения и мобильная версия',text:'На главной панели есть быстрый запуск приложений. HUB и кассу можно установить как приложение на ПК, а мобильный HUB — использовать как PWA на телефоне.'},
    {icon:'🔔',title:'Уведомления и помощь',text:'Разрешите Push-уведомления, чтобы не пропускать сообщения и важные события. В любой момент откройте «Инструкция» или «Поддержка» в боковом меню.'}
  ];
  let index=0,root=null;

  function css(){
    if(document.getElementById('a4-onboarding-style'))return;
    const s=document.createElement('style');s.id='a4-onboarding-style';s.textContent=`
      .a4-tour-backdrop{position:fixed;inset:0;z-index:20000;background:rgba(15,23,42,.58);display:grid;place-items:center;padding:20px;backdrop-filter:blur(4px)}
      .a4-tour-card{width:min(590px,100%);background:#fff;border-radius:24px;box-shadow:0 30px 90px rgba(15,23,42,.35);overflow:hidden}
      .a4-tour-progress{height:5px;background:#e2e8f0}.a4-tour-progress i{display:block;height:100%;background:#2563eb;transition:width .2s ease}
      .a4-tour-body{padding:28px}.a4-tour-icon{width:58px;height:58px;border-radius:18px;display:grid;place-items:center;background:#eff6ff;font-size:30px;margin-bottom:18px}.a4-tour-body h2{margin:0 0 10px;font-size:24px;color:#0f172a}.a4-tour-body p{margin:0;color:#475569;line-height:1.65;font-size:15px}.a4-tour-count{margin-top:18px;color:#94a3b8;font-size:12px;font-weight:800}.a4-tour-actions{display:flex;justify-content:space-between;gap:10px;padding:0 28px 28px}.a4-tour-actions>div{display:flex;gap:8px}.a4-tour-actions button,.a4-tour-actions a{min-height:42px;border-radius:11px;padding:0 14px;font:inherit;font-weight:800;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}.a4-tour-secondary{border:1px solid #dbe2ea;background:#fff;color:#475569}.a4-tour-primary{border:0;background:#2563eb;color:#fff}.a4-tour-primary:disabled{opacity:.45}@media(max-width:600px){.a4-tour-backdrop{padding:12px}.a4-tour-body{padding:22px}.a4-tour-actions{padding:0 22px 22px;flex-direction:column-reverse}.a4-tour-actions>div{width:100%}.a4-tour-actions button,.a4-tour-actions a{flex:1}}
    `;document.head.appendChild(s);
  }
  function render(){
    if(!root)return;const x=slides[index];
    root.querySelector('.a4-tour-progress i').style.width=`${((index+1)/slides.length)*100}%`;
    root.querySelector('.a4-tour-icon').textContent=x.icon;root.querySelector('h2').textContent=x.title;root.querySelector('p').textContent=x.text;root.querySelector('.a4-tour-count').textContent=`Шаг ${index+1} из ${slides.length}`;
    root.querySelector('[data-tour-prev]').disabled=index===0;root.querySelector('[data-tour-next]').textContent=index===slides.length-1?'Начать работу':'Далее';
  }
  function finish(mark=true){if(mark)try{localStorage.setItem(key(),'1')}catch{}root?.remove();root=null;document.documentElement.style.overflow=''}
  function open(){
    if(root)return;css();root=document.createElement('div');root.className='a4-tour-backdrop';root.innerHTML=`<section class="a4-tour-card" role="dialog" aria-modal="true" aria-label="Обучение A4PRINT HUB"><div class="a4-tour-progress"><i></i></div><div class="a4-tour-body"><div class="a4-tour-icon"></div><h2></h2><p></p><div class="a4-tour-count"></div></div><div class="a4-tour-actions"><button class="a4-tour-secondary" type="button" data-tour-skip>Пропустить</button><div><button class="a4-tour-secondary" type="button" data-tour-prev>Назад</button><button class="a4-tour-primary" type="button" data-tour-next>Далее</button></div></div></section>`;document.body.appendChild(root);document.documentElement.style.overflow='hidden';
    root.querySelector('[data-tour-skip]').onclick=()=>finish(true);root.querySelector('[data-tour-prev]').onclick=()=>{if(index>0){index--;render()}};root.querySelector('[data-tour-next]').onclick=()=>{if(index<slides.length-1){index++;render()}else finish(true)};render();
  }
  function maybe(){const id=currentUserId();if(!id&&!forced)return false;let done=false;try{done=localStorage.getItem(key())==='1'}catch{}if(forced||!done){index=0;open();return true}return false}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(maybe,700),{once:true});else setTimeout(maybe,700);
  let checks=0;const wait=setInterval(()=>{checks++;if(maybe()||checks>25)clearInterval(wait)},1000);
  window.A4Onboarding={open:()=>{index=0;open()},reset:()=>{try{localStorage.removeItem(key())}catch{}}};
})();
