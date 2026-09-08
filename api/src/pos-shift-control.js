import express from 'express';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl=process.env.SUPABASE_URL;
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
const msToken=process.env.MOYSKLAD_TOKEN;
const service=supabaseUrl&&serviceKey?createClient(supabaseUrl,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}}):null;
const BASE='https://api.moysklad.ru/api/remap/1.2';
const installed=Symbol.for('a4print.pos.shift.control.installed');
const originalListen=express.application.listen;
const originalPost=express.application.post;

const clean=(v,max=1000)=>String(v??'').trim().slice(0,max);
const idOf=e=>e?.id||e?.meta?.href?.split('/').pop()||null;

function msIso(value){
  const raw=String(value||'').trim();
  if(!raw)return new Date().toISOString();
  if(/Z$|[+-]\d\d:?\d\d$/.test(raw)){
    const d=new Date(raw.replace(' ','T'));
    return Number.isFinite(d.getTime())?d.toISOString():new Date().toISOString();
  }
  const m=raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if(m){
    const d=new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+03:00`);
    if(Number.isFinite(d.getTime()))return d.toISOString();
  }
  const d=new Date(raw.replace(' ','T'));
  return Number.isFinite(d.getTime())?d.toISOString():new Date().toISOString();
}

async function ms(path){
  if(!msToken)throw new Error('MOYSKLAD_NOT_CONFIGURED');
  const r=await fetch(path.startsWith('http')?path:BASE+path,{headers:{Authorization:`Bearer ${msToken}`,Accept:'application/json;charset=utf-8','Accept-Encoding':'gzip'}});
  if(!r.ok)throw new Error(`MoySklad HTTP ${r.status}: ${await r.text()}`);
  return r.status===204?null:r.json();
}

async function staffContext(req){
  if(!service)return{error:'DATABASE_NOT_CONFIGURED',status:503};
  const bearer=clean(req.headers.authorization,6000).replace(/^Bearer\s+/i,'');
  if(!bearer)return{error:'AUTH_REQUIRED',status:401};
  const {data,error}=await service.auth.getUser(bearer);
  if(error||!data?.user)return{error:'INVALID_SESSION',status:401};
  const {data:profile,error:pErr}=await service.from('users').select('id,full_name,email,is_active').eq('auth_user_id',data.user.id).maybeSingle();
  if(pErr)throw pErr;
  if(!profile||profile.is_active===false)return{error:'STAFF_ACCESS_REQUIRED',status:403};
  const {data:roleRows,error:rErr}=await service.from('user_roles').select('roles(name)').eq('user_id',profile.id);
  if(rErr)throw rErr;
  const roles=(roleRows||[]).map(x=>x.roles?.name).filter(Boolean);
  if(!roles.some(x=>x==='ADMIN'||x==='POS_OPERATOR'))return{error:'POS_ACCESS_REQUIRED',status:403};
  return{user:data.user,profile,roles,isAdmin:roles.includes('ADMIN')};
}

async function guard(req,res,handler,{admin=false}={}){
  try{
    const ctx=await staffContext(req);
    if(ctx.error)return res.status(ctx.status||403).json({success:false,error:ctx.error});
    if(admin&&!ctx.isAdmin)return res.status(403).json({success:false,error:'ADMIN_REQUIRED'});
    return await handler(ctx);
  }catch(error){
    console.error('[shift control]',error);
    return res.status(500).json({success:false,error:'INTERNAL_SERVER_ERROR',message:error.message});
  }
}

async function org(){
  const {data,error}=await service.from('organizations').select('id,code,name').eq('code','A4PRINT').single();
  if(error)throw error;
  return data;
}

async function liveMoySkladShift(){
  const list=await ms('/entity/retailshift?limit=100&order=created,desc');
  const open=(list?.rows||[]).filter(x=>!x.closeDate).sort((a,b)=>new Date(String(b.openDate||b.created||'').replace(' ','T'))-new Date(String(a.openDate||a.created||'').replace(' ','T')))[0]||null;
  if(!open)return{shift:null,store:null};
  let shift=open;
  const shiftId=idOf(open);
  if(shiftId){try{shift=await ms(`/entity/retailshift/${encodeURIComponent(shiftId)}`)}catch{}}
  const storeHref=shift?.retailStore?.meta?.href||open?.retailStore?.meta?.href||null;
  let store=null;
  if(storeHref){try{store=await ms(storeHref)}catch{}}
  return{
    shift:{
      id:idOf(shift)||shiftId,
      name:shift?.name||open?.name||null,
      openDate:shift?.openDate||shift?.moment||shift?.created||open?.openDate||open?.created||null,
      closeDate:shift?.closeDate||null,
      description:shift?.description||'',
      updated:shift?.updated||null
    },
    store:{id:idOf(store)||idOf(shift?.retailStore),name:store?.name||shift?.retailStore?.name||open?.retailStore?.name||null}
  };
}

async function userMap(ids){
  const unique=[...new Set((ids||[]).filter(Boolean))];
  if(!unique.length)return new Map();
  const {data,error}=await service.from('users').select('id,full_name,email').in('id',unique);
  if(error)throw error;
  return new Map((data||[]).map(x=>[x.id,x]));
}

function sessionView(row,users=new Map()){
  if(!row)return null;
  const opened=users.get(row.opened_by)||null;
  const closed=users.get(row.closed_by)||null;
  return{
    id:row.id,
    moysklad_shift_id:row.moysklad_shift_id,
    moysklad_shift_name:row.moysklad_shift_name,
    display_name:row.display_name||'',
    store_id:row.store_id,
    store_name:row.store_name,
    status:row.status,
    opened_at:row.opened_at,
    closed_at:row.closed_at,
    opening_note:row.opening_note||'',
    closing_note:row.closing_note||'',
    opened_by:opened?{id:opened.id,name:opened.full_name||opened.email||'Сотрудник'}:null,
    closed_by:closed?{id:closed.id,name:closed.full_name||closed.email||'Сотрудник'}:null,
    updated_at:row.updated_at
  };
}

async function reconcile({actorId=null,force=false}={}){
  const organization=await org();
  const live=await liveMoySkladShift();
  const now=new Date().toISOString();
  const {data:openRows,error:oErr}=await service.from('pos_shift_sessions').select('*').eq('organization_id',organization.id).eq('status','OPEN').order('opened_at',{ascending:false});
  if(oErr)throw oErr;
  let staleFixed=0;
  const liveId=live.shift?.id||null;
  for(const row of openRows||[]){
    if(!liveId||row.moysklad_shift_id!==liveId){
      const note='Автосверка HUB ↔ МойСклад: смена больше не является текущей';
      const {error}=await service.from('pos_shift_sessions').update({status:'CLOSED',closed_at:row.closed_at||now,closed_by:actorId||row.closed_by||null,closing_note:row.closing_note?`${row.closing_note}\n${note}`:note,updated_at:now}).eq('id',row.id);
      if(error)throw error;
      staleFixed++;
    }
  }

  let current=null;
  if(liveId){
    const storeId=live.store?.id||null;
    if(storeId){
      const {data:other,error:otherErr}=await service.from('pos_shift_sessions').select('id').eq('organization_id',organization.id).eq('store_id',storeId).eq('status','OPEN').neq('moysklad_shift_id',liveId);
      if(otherErr)throw otherErr;
      for(const row of other||[]){
        const {error}=await service.from('pos_shift_sessions').update({status:'CLOSED',closed_at:now,closed_by:actorId||null,closing_note:'Автосверка HUB: закрыта дублирующая OPEN-смена',updated_at:now}).eq('id',row.id);
        if(error)throw error;
        staleFixed++;
      }
    }
    const {data:existing,error:eErr}=await service.from('pos_shift_sessions').select('*').eq('organization_id',organization.id).eq('moysklad_shift_id',liveId).maybeSingle();
    if(eErr)throw eErr;
    const payload={
      organization_id:organization.id,
      moysklad_shift_id:liveId,
      moysklad_shift_name:live.shift.name||liveId,
      store_id:storeId,
      store_name:live.store?.name||null,
      opened_at:msIso(live.shift.openDate),
      status:'OPEN',
      closed_at:null,
      updated_at:now
    };
    if(!existing)payload.opened_by=actorId||null;
    const query=existing
      ?service.from('pos_shift_sessions').update(payload).eq('id',existing.id).select('*').single()
      :service.from('pos_shift_sessions').insert(payload).select('*').single();
    const {data,error}=await query;
    if(error)throw error;
    current=data;
  }

  const {data:recent,error:rErr}=await service.from('pos_shift_sessions').select('*').eq('organization_id',organization.id).order('opened_at',{ascending:false}).limit(12);
  if(rErr)throw rErr;
  const all=[current,...(recent||[])].filter(Boolean);
  const users=await userMap(all.flatMap(x=>[x.opened_by,x.closed_by]));
  return{
    organization,
    ms_shift:live.shift,
    store:live.store,
    hub_session:sessionView(current,users),
    recent:(recent||[]).map(x=>sessionView(x,users)),
    diagnostics:{
      synchronized:Boolean((!live.shift&&!current)||(live.shift&&current&&current.moysklad_shift_id===live.shift.id&&current.status==='OPEN')),
      stale_fixed:staleFixed,
      moysklad_open:Boolean(live.shift),
      hub_open:Boolean(current),
      forced:Boolean(force),
      checked_at:now
    }
  };
}

async function mirrorOpen(body,ctx){
  if(!body?.success||!body?.shift?.id||!service)return;
  try{
    const organization=await org();
    const now=new Date().toISOString();
    const shiftId=String(body.shift.id);
    const storeId=body.store?.id?String(body.store.id):null;
    if(storeId){
      await service.from('pos_shift_sessions').update({status:'CLOSED',closed_at:now,closing_note:'Автозакрытие HUB перед регистрацией новой смены',updated_at:now}).eq('organization_id',organization.id).eq('store_id',storeId).eq('status','OPEN').neq('moysklad_shift_id',shiftId);
    }
    const {data:existing}=await service.from('pos_shift_sessions').select('id').eq('organization_id',organization.id).eq('moysklad_shift_id',shiftId).maybeSingle();
    const payload={organization_id:organization.id,moysklad_shift_id:shiftId,moysklad_shift_name:body.shift.name||shiftId,store_id:storeId,store_name:body.store?.name||null,opened_at:msIso(body.shift.openDate),opened_by:body.operator?.id||ctx?.profile?.id||null,status:'OPEN',closed_at:null,updated_at:now};
    if(existing)await service.from('pos_shift_sessions').update(payload).eq('id',existing.id);
    else await service.from('pos_shift_sessions').insert(payload);
  }catch(error){console.error('[shift control mirror open]',error)}
}

async function mirrorClose(body,ctx){
  if(!body?.success||!body?.shift?.id||!service)return;
  try{
    const organization=await org();
    const now=new Date().toISOString();
    await service.from('pos_shift_sessions').update({moysklad_shift_name:body.shift.name||undefined,status:'CLOSED',closed_at:body.shift.closeDate?msIso(body.shift.closeDate):now,closed_by:body.operator?.id||ctx?.profile?.id||null,updated_at:now}).eq('organization_id',organization.id).eq('moysklad_shift_id',String(body.shift.id));
  }catch(error){console.error('[shift control mirror close]',error)}
}

express.application.listen=function patchedShiftControlListen(...args){
  if(!this[installed]){
    this[installed]=true;

    this.get('/api/v1/pos/shift/control',(req,res)=>guard(req,res,async ctx=>{
      const result=await reconcile({actorId:null});
      return res.json({success:true,permissions:{admin:ctx.isAdmin,edit_profile:ctx.isAdmin,reconcile:ctx.isAdmin},...result});
    }));

    this.patch('/api/v1/pos/shift/control/:sessionId',express.json(),(req,res)=>guard(req,res,async()=>{
      const id=clean(req.params.sessionId,80);
      const b=req.body||{};
      const updates={updated_at:new Date().toISOString()};
      if(b.display_name!==undefined)updates.display_name=clean(b.display_name,120)||null;
      if(b.opening_note!==undefined)updates.opening_note=clean(b.opening_note,2000)||null;
      const {data,error}=await service.from('pos_shift_sessions').update(updates).eq('id',id).select('*').maybeSingle();
      if(error)throw error;
      if(!data)return res.status(404).json({success:false,error:'SHIFT_SESSION_NOT_FOUND',message:'Смена HUB не найдена.'});
      return res.json({success:true,session:sessionView(data)});
    },{admin:true}));

    this.post('/api/v1/pos/shift/reconcile',express.json(),(req,res)=>guard(req,res,async ctx=>{
      const result=await reconcile({actorId:ctx.profile.id,force:true});
      return res.json({success:true,...result});
    },{admin:true}));
  }
  return originalListen.apply(this,args);
};

// Mirror successful open/close operations into HUB without changing the official
// MoySklad shift name. This wrapper composes with the other POS route patches.
express.application.post=function patchedShiftMirrorPost(path,...handlers){
  if((path==='/api/v1/pos/shift/open'||path==='/api/v1/pos/shift/close')&&handlers.length){
    const last=handlers.length-1;
    const original=handlers[last];
    handlers[last]=async function shiftMirrorHandler(req,res,next){
      const nativeJson=res.json.bind(res);
      res.json=function mirroredJson(body){
        try{
          const task=path.endsWith('/open')?mirrorOpen(body,{profile:{id:body?.operator?.id||null}}):mirrorClose(body,{profile:{id:body?.operator?.id||null}});
          Promise.resolve(task).catch(()=>{});
        }catch{}
        return nativeJson(body);
      };
      return original(req,res,next);
    };
  }
  return originalPost.call(this,path,...handlers);
};
