// 3D-ARTPRINT: browser sound at the end of planned printing time.
// This is a time estimate alert, not a physical printer-finished signal.
export function startPrintTimeAlerts({supabase,root,notify}){
 const bar=document.createElement('div');bar.className='production-alert-settings';
 bar.style.cssText='display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:12px 0;padding:12px;border:1px solid #3b4857;border-radius:12px';
 const button=document.createElement('button');button.type='button';button.textContent='🔔 Включить звук окончания печати';
 const hint=document.createElement('small');hint.textContent='Звук работает, пока открыта вкладка. Сигнал подаётся по истечении расчётного времени, а не по датчику принтера.';
 bar.append(button,hint);root.prepend(bar);
 let audio=null,enabled=false,busy=false,stopped=false;
 button.addEventListener('click',async()=>{
  try{
   if(enabled){enabled=false;button.textContent='🔔 Включить звук окончания печати';hint.textContent='Звуковые уведомления отключены';return}
   const Audio=window.AudioContext||window.webkitAudioContext;
   if(!Audio)throw Error('Браузер не поддерживает звук');
   audio=audio||new Audio();await audio.resume();
   enabled=true;button.textContent='🔕 Отключить звук';hint.textContent='Звуковые уведомления включены для этой вкладки';
   tone();
  }catch(error){hint.textContent='Не удалось включить звук: '+error.message}
 });
 function tone(){
  if(!enabled||!audio||audio.state!=='running')return;
  const now=audio.currentTime;
  [0,.23,.46].forEach((offset,i)=>{
   const oscillator=audio.createOscillator(),gain=audio.createGain();
   oscillator.type='sine';oscillator.frequency.value=i===2?950:760;
   gain.gain.setValueAtTime(.0001,now+offset);
   gain.gain.exponentialRampToValueAtTime(.14,now+offset+.015);
   gain.gain.exponentialRampToValueAtTime(.0001,now+offset+.17);
   oscillator.connect(gain);gain.connect(audio.destination);
   oscillator.start(now+offset);oscillator.stop(now+offset+.19);
  });
 }
 const seen=new Set();
 function announce(job,printer,elapsed){
  const start=String(job.started_at||job.id),key='3dartprint:print-time:'+job.id+':'+start+':'+job.planned_machine_minutes;
  if(seen.has(key))return;
  try{if(sessionStorage.getItem(key))return;sessionStorage.setItem(key,'1')}catch(_){}
  seen.add(key);
  const title='Плановое время печати завершено';
  const message=(job.title||'Задание')+' · заказ №'+(job.order_number||'—')+(printer?' · '+printer:'')+' · превышение '+Math.ceil(elapsed/60)+' мин.';
  tone();notify(title+': '+message);
  const alert=document.createElement('div');alert.setAttribute('role','alert');
  alert.style.cssText='margin:10px 0;padding:12px;border:1px solid #e6a14b;border-radius:10px;background:#37291a;color:#fff';
  alert.textContent='🔔 '+title+'. '+message+' Проверьте принтер и подтвердите завершение задания.';
  bar.after(alert);
  // Keep a bounded history on the current page.
  root.querySelectorAll('[data-print-alert]').forEach((node,i)=>{if(i>=9)node.remove()});
  alert.dataset.printAlert='true';
 }
 async function check(){
  if(stopped||busy||!root.isConnected||document.hidden)return;
  busy=true;
  try{
   const {data,error}=await supabase.rpc('get_production_workspace_jobs',{p_query:'',p_unit:'3D_ARTPRINT',p_assignee:null,p_priority:'',p_done_limit:10,p_cancelled_limit:0});
   if(error)throw error;
   const jobs=(Array.isArray(data)?data:[]).filter(j=>j.order_business_unit==='3D_ARTPRINT'&&j.status==='IN_PROGRESS'&&Number(j.planned_machine_minutes)>0);
   if(!jobs.length)return;
   const ids=jobs.map(j=>j.id);
   const rr=await supabase.from('production_job_runs').select('production_job_id,started_at,ended_at,elapsed_seconds').in('production_job_id',ids);
   if(rr.error)throw rr.error;
   const now=Date.now();
   for(const job of jobs){
    const elapsed=(rr.data||[]).filter(r=>r.production_job_id===job.id).reduce((sum,r)=>{
     const start=Date.parse(r.started_at),end=r.ended_at?Date.parse(r.ended_at):now;
     if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return sum;
     return sum+(r.ended_at&&Number.isFinite(Number(r.elapsed_seconds))?Number(r.elapsed_seconds):(end-start)/1000);
    },0);
    const excess=elapsed-Number(job.planned_machine_minutes)*60;
    if(excess>=0)announce(job,'',excess);
   }
  }catch(error){console.warn('3D print time notifications:',error)}
  finally{busy=false}
 }
 const interval=setInterval(check,15000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void check()});
 void check();
 return ()=>{stopped=true;clearInterval(interval)};
}
