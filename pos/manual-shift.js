(()=>{
  if(window.__A4_POS_MANUAL_SHIFT__)return;
  window.__A4_POS_MANUAL_SHIFT__=true;

  const KEY='a4_pos_manual_shift_v1';
  const nativeFetch=window.fetch.bind(window);

  function readState(){
    try{return JSON.parse(sessionStorage.getItem(KEY)||'null')}catch{return null}
  }
  function saveState(operatorId,shiftId){
    try{sessionStorage.setItem(KEY,JSON.stringify({operatorId:String(operatorId||''),shiftId:String(shiftId||''),startedAt:new Date().toISOString()}))}catch{}
  }
  function clearState(){try{sessionStorage.removeItem(KEY)}catch{}}
  function currentOperator(){return document.getElementById('operatorSelect')?.value||''}
  function pathOf(input){
    try{return new URL(typeof input==='string'?input:input.url,location.href).pathname}catch{return ''}
  }
  function methodOf(input,init){return String(init?.method||input?.method||'GET').toUpperCase()}
  function bodyOperator(init){
    try{const d=typeof init?.body==='string'?JSON.parse(init.body):init?.body;return String(d?.operator_id||'')}catch{return ''}
  }
  function showWaitingState(data){
    setTimeout(()=>{
      const remote=data?.shift;
      const dot=document.getElementById('shiftDot');
      const topDot=document.getElementById('topShiftDot');
      const btn=document.getElementById('shiftBtn');
      if(dot)dot.className='dot';
      if(topDot)topDot.className='dot';
      const shiftText=document.getElementById('shiftText');
      if(shiftText)shiftText.textContent='Смена не начата';
      const top=document.getElementById('topShift');
      if(top)top.textContent='Смена не начата';
      const status=document.getElementById('shiftStatusSync');
      if(status)status.textContent='Ожидает оператора';
      const meta=document.getElementById('shiftMetaSide');
      if(meta)meta.textContent=remote?`В МойСклад уже есть открытая смена · нажмите «Начать смену»`:'Нажмите «Открыть смену»';
      if(btn){btn.textContent=remote?'Начать смену':'Открыть смену';btn.className='btn success';}
    },0);
  }
  async function rewriteShiftResponse(response){
    if(!response.ok)return response;
    const data=await response.clone().json().catch(()=>null);
    if(!data||typeof data!=='object')return response;
    const state=readState();
    const operator=currentOperator();
    const active=Boolean(data.shift&&state?.shiftId===String(data.shift.id||'')&&state?.operatorId===String(operator||''));
    if(active)return response;
    showWaitingState(data);
    const hidden={...data,shift:null,manualActivationRequired:Boolean(data.shift),availableShift:data.shift?{id:data.shift.id,name:data.shift.name,openDate:data.shift.openDate}:null};
    return new Response(JSON.stringify(hidden),{status:response.status,statusText:response.statusText,headers:new Headers(response.headers)});
  }

  window.fetch=async function(input,init){
    const path=pathOf(input),method=methodOf(input,init);
    const response=await nativeFetch(input,init);

    if(path==='/api/v1/pos/shift'&&method==='GET')return rewriteShiftResponse(response);

    if(path==='/api/v1/pos/shift/open'&&method==='POST'&&response.ok){
      const data=await response.clone().json().catch(()=>null);
      saveState(bodyOperator(init)||currentOperator(),data?.shift?.id||'');
      return response;
    }

    if(path==='/api/v1/pos/shift/close'&&method==='POST'&&response.ok){
      clearState();
      return response;
    }

    return response;
  };

  document.addEventListener('click',e=>{
    if(e.target?.closest?.('#logout'))clearState();
  },true);
})();
