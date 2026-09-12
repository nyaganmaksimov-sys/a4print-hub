const $=id=>document.getElementById(id);

function fixMovementQuantityBounds(){
  const input=$('moveQty');
  if(!input)return;
  const type=$('moveType')?.value||'';
  if(type==='ADJUSTMENT'){
    input.min='0';
    return;
  }
  const step=Number(input.step||0.001);
  input.min=Number.isFinite(step)&&step>0?String(step):'0.001';
}

function bind(){
  const input=$('moveQty');
  const type=$('moveType');
  const consumable=$('moveConsumable');
  const dialog=$('movementDlg');
  if(!input||!dialog)return;

  const afterV2=()=>setTimeout(fixMovementQuantityBounds,0);
  input.addEventListener('input',afterV2);
  type?.addEventListener('change',afterV2);
  consumable?.addEventListener('change',afterV2);
  new MutationObserver(()=>{if(dialog.open)afterV2()}).observe(dialog,{attributes:true,attributeFilter:['open']});
  fixMovementQuantityBounds();
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
