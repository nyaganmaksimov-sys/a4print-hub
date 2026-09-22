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

  function css(){/* styles are provided by admin/ui/components.css */}
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
  function injectHelpLauncher(){
    if(!/\/admin\/help\.html$/.test(location.pathname))return;
    const hero=document.querySelector('.hero');if(!hero||hero.querySelector('[data-a4-tour-launcher]'))return;
    css();const b=document.createElement('button');b.type='button';b.className='a4-tour-launcher';b.dataset.a4TourLauncher='1';b.textContent='▶ Повторить обучение по системе';b.onclick=()=>{index=0;open()};hero.appendChild(b);
  }
  const start=()=>{injectHelpLauncher();setTimeout(maybe,700)};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  window.A4Onboarding={open:()=>{index=0;open()},reset:()=>{try{localStorage.removeItem(key())}catch{}}};
})();
