// Authenticated MoySklad invoices workflow. Calls run only on the backend.
import { randomUUID } from 'node:crypto';
import { moyskladRequest } from './moysklad.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str=(v,n=250)=>String(v??'').trim().slice(0,n);
const wrap=(value,type)=>({meta:{href:'https://api.moysklad.ru/api/remap/1.2/entity/'+type+'/'+value,type,mediaType:'application/json'}});
const safeId=value=>{const id=str(value,40);if(!uuid.test(id))throw Object.assign(new Error('Некорректный идентификатор'),{status:400});return id};
const reqBody=(req)=>req.body&&typeof req.body==='object'&&!Array.isArray(req.body)?req.body:{};
const fail=(res,message,status=400)=>res.status(status).json({success:false,error:'INVALID_INVOICE_REQUEST',message});
const shortInvoice=x=>({id:x.id,name:x.name||'',moment:x.moment||'',agent_name:x.agent?.name||'',agent_id:x.agent?.id||null,organization_name:x.organization?.name||'',sum:Number(x.sum||0)/100,payed_sum:Number(x.payedSum||0)/100,description:x.description||'',state:x.state?.name||'',updated:x.updated||'',href:x.meta?.uuidHref||null});
const sendError=(res,next,error)=>{if(error.status&&error.status<500)return res.status(error.status).json({success:false,error:'MOYSKLAD_ERROR',message:error.message});next(error)};
export function registerPosMoySkladInvoices(app,requirePosUser,msReady,msTenantReady,getToken){
  const protect=[requirePosUser,async(req,res,next)=>{try{if(!msReady(res))return;if(!(await msTenantReady(req,res)))return;next()}catch(e){next(e)}}];
  const api=(path,opt)=>moyskladRequest(getToken(),path,opt);
  app.get('/api/v1/pos/invoices',...protect,async(req,res,next)=>{
    try{
      const offset=Math.max(0,Math.min(1000000,Math.floor(Number(req.query.offset)||0)));
      const limit=100;
      const rows=await api('/entity/invoiceout?limit='+limit+'&offset='+offset+'&order=moment,desc&expand=agent,organization,state');
      res.json({success:true,invoices:(rows.rows||[]).map(shortInvoice),offset,limit,total:rows.meta?.size??null,has_more:!!rows.meta?.nextHref});
    }catch(e){sendError(res,next,e)}
  });
  app.get('/api/v1/pos/invoices/:id',...protect,async(req,res,next)=>{
    try{const id=safeId(req.params.id);const x=await api('/entity/invoiceout/'+id+'?expand=agent,organization,state,positions.assortment');res.json({success:true,invoice:shortInvoice(x),positions:(x.positions?.rows||[]).map(p=>({name:p.assortment?.name||'',quantity:p.quantity,price:Number(p.price||0)/100,sum:p.quantity*Number(p.price||0)/100}))})}catch(e){sendError(res,next,e)}
  });
  app.get('/api/v1/pos/invoices/lookup/organizations',...protect,async(req,res,next)=>{
    try{const data=await api('/entity/organization?limit=100');res.json({success:true,organizations:(data.rows||[]).filter(x=>!x.archived).map(x=>({id:x.id,name:x.name,inn:x.inn||''}))})}catch(e){sendError(res,next,e)}
  });
  app.get('/api/v1/pos/invoices/lookup/counterparties',...protect,async(req,res,next)=>{
    try{
      const q=str(req.query.q,100);
      let url='/entity/counterparty?limit=100&order=name,asc';
      if(q)url+='&filter='+encodeURIComponent('name~'+q.replace(/[;=]/g,' '));
      const data=await api(url);
      res.json({success:true,counterparties:(data.rows||[]).map(x=>({id:x.id,name:x.name,inn:x.inn||'',phone:x.phone||'',email:x.email||''}))});
    }catch(e){sendError(res,next,e)}
  });
  app.post('/api/v1/pos/invoices/lookup/counterparties',...protect,async(req,res,next)=>{
    try{
      const b=reqBody(req);const name=str(b.name,200),inn=str(b.inn,12),phone=str(b.phone,50),email=str(b.email,150);
      if(name.length<2)return fail(res,'Укажите название контрагента.');
      if(inn&&!/^\d{10}(\d{2})?$/.test(inn))return fail(res,'ИНН должен содержать 10 или 12 цифр.');
      if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return fail(res,'Неверный email.');
      if(inn){
        const match=await api('/entity/counterparty?limit=100&filter='+encodeURIComponent('inn='+inn));
        if(match.rows?.length)return res.status(409).json({success:false,error:'COUNTERPARTY_EXISTS',message:'Контрагент с таким ИНН уже есть в МойСклад.',counterparties:match.rows.map(x=>({id:x.id,name:x.name,inn:x.inn}))});
      }
      const x=await api('/entity/counterparty',{method:'POST',body:JSON.stringify({name,...(inn?{inn}:{}),...(phone?{phone}:{}),...(email?{email}:{})})});
      res.status(201).json({success:true,counterparty:{id:x.id,name:x.name,inn:x.inn||'',phone:x.phone||'',email:x.email||''}});
    }catch(e){sendError(res,next,e)}
  });
  app.get('/api/v1/pos/invoices/lookup/assortment',...protect,async(req,res,next)=>{
    try{
      const q=str(req.query.q,100),url='/entity/assortment?limit=100'+(q?'&filter='+encodeURIComponent('name~'+q.replace(/[;=]/g,' ')):'');
      const data=await api(url);
      const allowed=new Set(['product','variant','service','bundle']);
      res.json({success:true,items:(data.rows||[]).filter(x=>allowed.has(x.meta?.type)&&!x.archived).map(x=>({id:x.id,type:x.meta.type,name:x.name,price:Number(x.salePrices?.[0]?.value||0)/100,vat:x.vat??null,vatEnabled:x.vatEnabled??null}))});
    }catch(e){sendError(res,next,e)}
  });

  // Payment approval is verified against MoySklad's recorded incoming funds.
  // It intentionally does NOT fabricate a cash-in or bank receipt.
  const closingLock=new Set();
  const closingCode=id=>'A4CLOSE-'+id.replace(/-/g,'');
  const lookupByCode=async(type,externalCode)=>{
    const data=await api('/entity/'+type+'?limit=10&filter='+encodeURIComponent('externalCode='+externalCode));
    return data.rows?.[0]||null;
  };
  const closingSnapshot=async(id)=>{
    const invoice=await api('/entity/invoiceout/'+id+'?expand=agent,organization,positions.assortment');
    const sum=Number(invoice.sum||0),paid=Number(invoice.payedSum||0);
    const positions=invoice.positions?.rows||[];
    const related=await lookupByCode('demand',closingCode(id));
    const facture=related?await lookupByCode('factureout',closingCode(id)):null;
    return{invoice,sum,paid,positions,related,facture,fullyPaid:sum>0&&paid>=sum};
  };
  const closingView=s=>({
    invoice:shortInvoice(s.invoice),fully_paid:s.fullyPaid,outstanding:Math.max(0,(s.sum-s.paid)/100),
    demand:s.related?{id:s.related.id,name:s.related.name,url:s.related.meta?.uuidHref||null}:null,
    facture:s.facture?{id:s.facture.id,name:s.facture.name,url:s.facture.meta?.uuidHref||null}:null,
    items:s.positions.map(p=>({name:p.assortment?.name||'',type:p.assortment?.meta?.type||'',quantity:p.quantity})),
    vat_enabled:Boolean(s.invoice.vatEnabled),vat_sum:Number(s.invoice.vatSum||0)/100
  });
  app.get('/api/v1/pos/invoices/:id/closing',...protect,async(req,res,next)=>{
    try{const id=safeId(req.params.id);res.json({success:true,...closingView(await closingSnapshot(id))})}catch(e){sendError(res,next,e)}
  });
  app.post('/api/v1/pos/invoices/:id/closing/prepare',...protect,async(req,res,next)=>{
    const id=safeId(req.params.id);
    if(closingLock.has(id))return fail(res,'Подготовка документов уже выполняется. Обновите карточку счёта.',409);
    closingLock.add(id);
    try{
      const s=await closingSnapshot(id),invoice=s.invoice;
      if(!s.fullyPaid)return fail(res,'Оплата ещё не отражена полностью в МойСклад. Сначала проведите поступление денег и обновите статус.',409);
      if(!s.positions.length)return fail(res,'Счёт без позиций не может быть закрыт.',409);
      if(!invoice.agent?.meta||!invoice.organization?.meta)return fail(res,'Не найдены контрагент или юридическое лицо.',409);
      if(!s.related){
        const containsGoods=s.positions.some(p=>p.assortment?.meta?.type!=='service');
        const stores=containsGoods?await api('/entity/store?limit=100'):null;
        const requestedStore=str(reqBody(req).store_id,40);
        if(containsGoods&&!requestedStore)return fail(res,'В счёте есть товары: выберите склад фактической отгрузки.',409);
        if(containsGoods&&!stores.rows?.some(x=>x.id===requestedStore))return fail(res,'Выбранный склад недоступен.',409);
        const positions=s.positions.map(p=>({
          assortment:p.assortment,quantity:p.quantity,price:p.price,
          ...(p.discount!=null?{discount:p.discount}:{}),
          ...(p.vat!=null?{vat:p.vat}:{}),
          ...(p.vatEnabled!=null?{vatEnabled:p.vatEnabled}:{})
        }));
        const payload={
          externalCode:closingCode(id),agent:invoice.agent,organization:invoice.organization,
          positions,description:'По счёту '+invoice.name+' · A4PRINT KASSA',
          ...(containsGoods?{store:wrap(requestedStore,'store')}:{})
        };
        s.related=await api('/entity/demand',{method:'POST',body:JSON.stringify(payload)});
      }
      // A facture is not universally required: only create one for taxable VAT sales.
      if(s.invoice.vatEnabled&&Number(s.invoice.vatSum||0)>0&&!s.facture){
        const payload={
          externalCode:closingCode(id),
          organization:invoice.organization,agent:invoice.agent,
          demand:wrap(s.related.id,'demand'),
          description:'По счёту '+invoice.name+' · A4PRINT KASSA'
        };
        s.facture=await api('/entity/factureout',{method:'POST',body:JSON.stringify(payload)});
      }
      res.json({success:true,...closingView(s),note:'Созданы документы МойСклад. Перед выдачей распечатайте и проверьте реквизиты, вид документа и налоговый режим.'});
    }catch(e){sendError(res,next,e)}
    finally{closingLock.delete(id)}
  });
  app.get('/api/v1/pos/invoices/lookup/stores',...protect,async(req,res,next)=>{
    try{const data=await api('/entity/store?limit=100');res.json({success:true,stores:(data.rows||[]).filter(x=>!x.archived).map(x=>({id:x.id,name:x.name}))})}catch(e){sendError(res,next,e)}
  });

  const processing=new Map();
  app.post('/api/v1/pos/invoices',...protect,async(req,res,next)=>{
    try{
      const b=reqBody(req);const key=str(b.operation_id,40);
      if(!uuid.test(key))return fail(res,'Некорректный идентификатор операции.');
      const agentId=safeId(b.agent_id),organizationId=safeId(b.organization_id);
      const raw=Array.isArray(b.items)?b.items:[];
      if(!raw.length||raw.length>40)return fail(res,'Добавьте от 1 до 40 позиций.');
      const items=raw.map(x=>{
        const id=safeId(x.id);const type=str(x.type,20);
        if(!['product','service','variant','bundle'].includes(type))throw Object.assign(new Error('Недопустимый тип позиции'),{status:400});
        const qty=Number(x.quantity),price=Number(x.price);
        if(!Number.isFinite(qty)||qty<=0||qty>100000||!Number.isFinite(price)||price<0||price>100000000)throw Object.assign(new Error('Проверьте количество и стоимость позиций.'),{status:400});
        return{assortment:wrap(id,type),quantity:qty,price:Math.round(price*100)};
      });
      if(processing.has(key))return res.status(409).json({success:false,error:'REQUEST_IN_PROGRESS',message:'Этот счёт уже создаётся. Обновите список через несколько секунд.'});
      processing.set(key,true);
      try{
        const matches=await api('/entity/invoiceout?limit=10&filter='+encodeURIComponent('externalCode='+key));
        if(matches.rows?.length)return res.json({success:true,reused:true,invoice:shortInvoice(matches.rows[0])});
        // The IDs are revalidated against the MoySklad account; no browser-supplied meta URLs.
        const [agents,orgs]=await Promise.all([api('/entity/counterparty/'+agentId),api('/entity/organization/'+organizationId)]);
        if(!agents?.id||!orgs?.id||orgs.archived)return fail(res,'Контрагент или организация недоступны.');
        const payload={externalCode:key,agent:wrap(agentId,'counterparty'),organization:wrap(organizationId,'organization'),positions:items,description:str(b.description,500)};
        const x=await api('/entity/invoiceout',{method:'POST',body:JSON.stringify(payload)});
        res.status(201).json({success:true,invoice:shortInvoice(x)});
      }finally{processing.delete(key)}
    }catch(e){sendError(res,next,e)}
  });
}
