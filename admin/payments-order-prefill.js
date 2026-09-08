import {supabase} from './guard.js?v=20260905-netfix1';

const params=new URLSearchParams(location.search);
const orderId=params.get('order')||'';
if(orderId){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const {data:order}=await supabase.from('orders').select('id,customer_id,total').eq('id',orderId).maybeSingle();
  if(order){
    for(let i=0;i<30;i++){
      const dlg=document.getElementById('paymentDlg'),customer=document.getElementById('paymentCustomer'),orderSelect=document.getElementById('paymentOrder'),amount=document.getElementById('paymentAmount');
      if(dlg&&customer&&orderSelect&&amount){
        if(!dlg.open&&document.getElementById('addPayment'))document.getElementById('addPayment').click();
        if(order.customer_id&&[...customer.options].some(o=>o.value===order.customer_id)&&customer.value!==order.customer_id){customer.value=order.customer_id;customer.dispatchEvent(new Event('change',{bubbles:true}));await sleep(60)}
        if([...orderSelect.options].some(o=>o.value===order.id)){orderSelect.value=order.id;orderSelect.dispatchEvent(new Event('change',{bubbles:true}));if(!params.get('document'))amount.value=Number(order.total||0).toFixed(2);break}
      }
      await sleep(100);
    }
  }
}
