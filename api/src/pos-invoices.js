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


  // Operator-recorded payments are real finance documents, not a flag on the invoice.
  // Cash goes to cashin; a transfer to a personal card must never be misclassified.
  const paymentLocks=new Set();
  const paymentCode=(id,operationId)=>'A4INV-'+id.replace(/-/g,'').slice(0,16)+'-'+operationId.replace(/-/g,'');
  app.get('/api/v1/pos/invoices/:id/payment-options',...protect,async(req,res,next)=>{
    try{
      const id=safeId(req.params.id),invoice=await api('/entity/invoiceout/'+id+'?expand=organization');
      const orgId=invoice.organization?.id||invoice.organization?.meta?.href?.split('/').pop();
      if(!orgId) return fail(res,'У счёта не указана наша организация.',409);
      const organization=await api('/entity/organization/'+safeId(orgId));
      // Account metadata is returned by the organization and stays server-owned.
      const accounts=Array.isArray(organization.accounts)?organization.accounts:[];
      res.json({success:true,remaining:Math.max(0,(Number(invoice.sum||0)-Number(invoice.payedSum||0))/100),
        bank_accounts:accounts.filter(a=>a.meta?.href&&!a.archived).map(a=>({id:a.id||a.meta.href.split('/').pop(),name:[a.accountNumber,a.bankName].filter(Boolean).join(' · ')||'Расчётный счёт',href:a.meta.href})),
        available_methods:['CASH','BANK']});
    }catch(e){sendError(res,next,e)}
  });
  app.post('/api/v1/pos/invoices/:id/confirm-payment',...protect,async(req,res,next)=>{
    let key=null;
    try{
      const id=safeId(req.params.id),b=reqBody(req),opId=safeId(b.operation_id);
      const method=str(b.method,20),amount=Number(b.amount);
      if(!['CASH','BANK'].includes(method))return fail(res,'Выберите наличные или банковский перевод.');
      if(!Number.isFinite(amount)||amount<=0||Math.abs(Math.round(amount*100)-amount*100)>0.00001||amount>100000000)return fail(res,'Сумма должна быть положительной, с точностью до копеек.');
      const cents=Math.round(amount*100);
      key=paymentCode(id,opId);
      if(paymentLocks.has(key))return fail(res,'Операция уже выполняется. Обновите статус счёта.',409);
      paymentLocks.add(key);
      try{
        const type=method==='CASH'?'cashin':'paymentin';
        const find=()=>api('/entity/'+type+'?limit=100&filter='+encodeURIComponent('externalCode='+key));
        const existing=await find();
        if(existing.rows?.length)return res.json({success:true,reused:true,payment:{id:existing.rows[0].id,name:existing.rows[0].name,method},message:'Платёж уже был зарегистрирован в МойСклад.'});
        const invoice=await api('/entity/invoiceout/'+id+'?expand=agent,organization');
        const outstanding=Number(invoice.sum||0)-Number(invoice.payedSum||0);
        if(!(outstanding>0))return fail(res,'Счёт уже оплачен. Дополнительный платёж не создан.',409);
        if(cents>outstanding)return fail(res,'Сумма превышает остаток задолженности по счёту.',409);
        if(!invoice.agent?.meta||!invoice.organization?.meta)return fail(res,'Контрагент или организация счёта не найдены.',409);
        const payload={
          externalCode:key,
          organization:{meta:invoice.organization.meta},agent:{meta:invoice.agent.meta},
          operations:[{meta:wrap(id,'invoiceout').meta,linkedSum:cents}],
          paymentPurpose:'Оплата счёта '+str(invoice.name,100)+' · A4PRINT KASSA',
          description:'A4PRINT KASSA · подтверждено оператором после фактического поступления денег',
          sum:cents
        };
        if(method==='BANK'){
          const accountId=safeId(b.account_id);
          const org=await api('/entity/organization/'+safeId(invoice.organization.id||invoice.organization.meta.href.split('/').pop()));
          const accounts=Array.isArray(org.accounts)?org.accounts:[];
          const account=accounts.find(a=>(a.id||a.meta?.href?.split('/').pop())===accountId&&a.meta?.href);
          if(!account)return fail(res,'Выберите действующий расчётный счёт организации.',409);
          payload.organizationAccount={meta:account.meta};
          // Only a real receipt to a registered company account can become paymentin.
        }
        const posted=await api('/entity/'+type,{method:'POST',body:JSON.stringify(payload)});
        res.status(201).json({success:true,payment:{id:posted.id,name:posted.name||'',method},message:'Поступление зарегистрировано в МойСклад.'});
      }finally{paymentLocks.delete(key)}
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
    const linkedDemands=Array.isArray(invoice.demands)?invoice.demands:[];
    const related=await lookupByCode('demand',closingCode(id));
    // Existing manually issued shipments must be reviewed rather than duplicated.
    const hasOtherShipments=linkedDemands.some(d=>d.meta?.href&&!d.meta.href.endsWith('/'+(related?.id||'')));
    const facture=related?await lookupByCode('factureout',closingCode(id)):null;
    return{invoice,sum,paid,positions,related,facture,hasOtherShipments,fullyPaid:sum>0&&paid>=sum};
  };
  const closingView=s=>({
    invoice:shortInvoice(s.invoice),fully_paid:s.fullyPaid,outstanding:Math.max(0,(s.sum-s.paid)/100),
    demand:s.related?{id:s.related.id,name:s.related.name,url:s.related.meta?.uuidHref||null}:null,existing_shipments_need_review:s.hasOtherShipments,
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
      if(s.hasOtherShipments)return fail(res,'К этому счёту уже привязана другая отгрузка. Проверьте документы в МойСклад, чтобы не создать дубли.',409);
      if(!s.positions.length)return fail(res,'Счёт без позиций не может быть закрыт.',409);
      if(!invoice.agent?.meta||!invoice.organization?.meta)return fail(res,'Не найдены контрагент или юридическое лицо.',409);
      if(!s.related){
        const containsGoods=s.positions.some(p=>p.assortment?.meta?.type!=='service');
        const stores=await api('/entity/store?limit=100');
        const requestedStore=str(reqBody(req).store_id,40);
        if(!requestedStore)return fail(res,'Выберите склад оформления реализации (требование МойСклад).',409);
        if(!stores.rows?.some(x=>x.id===requestedStore&&!x.archived))return fail(res,'Выбранный склад недоступен.',409);
        const positions=s.positions.map(p=>({
          assortment:{meta:p.assortment.meta},quantity:p.quantity,price:p.price,
          ...(p.discount!=null?{discount:p.discount}:{}),
          ...(p.vat!=null?{vat:p.vat}:{}),
          ...(p.vatEnabled!=null?{vatEnabled:p.vatEnabled}:{})
        }));
        const payload={
          externalCode:closingCode(id),agent:{meta:invoice.agent.meta},organization:{meta:invoice.organization.meta},
          positions,invoicesOut:[wrap(id,'invoiceout')],description:'По счёту '+invoice.name+' · A4PRINT KASSA',
          store:wrap(requestedStore,'store')
        };
        s.related=await api('/entity/demand',{method:'POST',body:JSON.stringify(payload)});
      }
      // A facture is not universally required: only create one for taxable VAT sales.
      if(s.invoice.vatEnabled&&Number(s.invoice.vatSum||0)>0&&!s.facture){
        const payload={
          externalCode:closingCode(id),
          organization:{meta:invoice.organization.meta},agent:{meta:invoice.agent.meta},
          demands:[wrap(s.related.id,'demand')],
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


  // Expose only supported printable templates. PDF bytes are proxied server-side;
  // no MoySklad access token or temporary print URL is sent to the browser.
  const printTypes=new Set(['invoiceout','demand','factureout']);
  async function documentToPrint(id,type){
    const snap=await closingSnapshot(id);
    if(type==='invoiceout')return{id:snap.invoice.id,type};
    if(type==='demand'&&snap.related)return{id:snap.related.id,type};
    if(type==='factureout'&&snap.facture)return{id:snap.facture.id,type};
    throw Object.assign(new Error('Документ для печати пока не создан.'),{status:409});
  }
  async function templates(type){
    const d=await api('/entity/'+type+'/metadata/embeddedtemplate');
    return(d.rows||[]).map(t=>({id:t.id,name:t.name||'',type:t.meta?.type||'embeddedtemplate'})).filter(t=>uuid.test(t.id));
  }
  app.get('/api/v1/pos/invoices/:id/closing/templates',...protect,async(req,res,next)=>{
    try{
      const id=safeId(req.params.id),snap=await closingSnapshot(id);
      const docs=[{type:'invoiceout',ready:true},{type:'demand',ready:!!snap.related},{type:'factureout',ready:!!snap.facture}];
      const results=await Promise.all(docs.filter(d=>d.ready).map(async d=>({...d,templates:await templates(d.type)})));
      res.json({success:true,documents:results});
    }catch(e){sendError(res,next,e)}
  });
  app.get('/api/v1/pos/invoices/:id/closing/pdf',...protect,async(req,res,next)=>{
    try{
      const id=safeId(req.params.id),type=str(req.query.type,25),templateId=safeId(req.query.template);
      if(!printTypes.has(type))return fail(res,'Недопустимый тип документа.');
      const doc=await documentToPrint(id,type);
      const available=await templates(type);
      if(!available.some(t=>t.id===templateId))return fail(res,'Шаблон печати недоступен.');
      const requestBody={template:wrap(templateId,'embeddedtemplate'),extension:'pdf'};
      requestBody.template.meta.href='https://api.moysklad.ru/api/remap/1.2/entity/'+type+'/metadata/embeddedtemplate/'+templateId;
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
      let response;
      try{
        response=await fetch('https://api.moysklad.ru/api/remap/1.2/entity/'+type+'/'+doc.id+'/export',{
          method:'POST',headers:{Authorization:'Bearer '+getToken(),Accept:'application/pdf','Content-Type':'application/json'},body:JSON.stringify(requestBody),signal:controller.signal
        });
        if(!response.ok)throw Object.assign(new Error('Не удалось получить печатную форму: '+response.status),{status:502});
        const data=Buffer.from(await response.arrayBuffer());
        if(data.length<5||data.subarray(0,5).toString()!=='%PDF-')throw Object.assign(new Error('МойСклад не вернул PDF. Проверьте шаблон документа.'),{status:502});
        if(data.length>20*1024*1024)throw Object.assign(new Error('Файл превышает лимит 20 МБ.'),{status:502});
        res.setHeader('Content-Type','application/pdf');
        res.setHeader('Content-Disposition','inline; filename="'+type+'-'+doc.id+'.pdf"');
        res.setHeader('Cache-Control','private, no-store');
        res.send(data);
      }finally{clearTimeout(timeout)}
    }catch(e){sendError(res,next,e)}
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
