import express from 'express';
import { createClient } from '@supabase/supabase-js';

const installed=Symbol.for('a4print.jarvis.control.bridge.installed');
const originalListen=express.application.listen;

function config(){return{url:String(process.env.SUPABASE_URL||'').replace(/\/$/,''),key:String(process.env.SUPABASE_PUBLISHABLE_KEY||''),jarvisUrl:String(process.env.JARVIS_WORKSHOP_URL||'').replace(/\/$/,''),jarvisKey:String(process.env.JARVIS_API_KEY||'')}}
function scopedDb(token){const c=config();if(!c.url||!c.key)throw Object.assign(new Error('DATABASE_NOT_CONFIGURED'),{status:503});return createClient(c.url,c.key,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})}
async function requireSession(req,res,next){
  try{const c=config(),token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();if(!token)return res.status(401).json({success:false,error:'AUTH_REQUIRED'});const r=await fetch(`${c.url}/auth/v1/user`,{headers:{Authorization:`Bearer ${token}`,apikey:c.key}});if(!r.ok)return res.status(401).json({success:false,error:'INVALID_SESSION'});req.jarvisToken=token;req.jarvisUser=await r.json();next()}catch(error){next(error)}
}
function clean(text){return String(text||'').trim().replace(/^джарвис[\s,:-]*/i,'').trim()}
async function currentStaff(req){const db=scopedDb(req.jarvisToken);const {data,error}=await db.from('users').select('id,full_name,email').eq('auth_user_id',req.jarvisUser.id).maybeSingle();if(error)throw error;if(!data)throw Object.assign(new Error('STAFF_PROFILE_REQUIRED'),{status:403});return{db,user:data}}
async function employeeMatches(req,name){const db=scopedDb(req.jarvisToken);const {data,error}=await db.rpc('jarvis_semantic_search',{p_query:String(name||'').slice(0,300),p_limit:12});if(error)throw error;return(data||[]).filter(x=>x.entity_type==='employee').slice(0,6)}
async function roomFor(req,target){
  const {db}=await currentStaff(req);const value=String(target||'').trim();
  if(/^(?:в\s+)?общ/i.test(value)){const {data,error}=await db.from('chat_rooms').select('id,name').eq('name','Общий чат').limit(1).maybeSingle();if(error)throw error;if(!data?.id)throw new Error('GENERAL_CHAT_NOT_FOUND');return{db,roomId:data.id,targetName:'общий чат'}}
  const rows=await employeeMatches(req,value);if(!rows.length)return{db,errorText:`Не нашёл сотрудника «${value}».`};
  const first=rows[0],second=rows[1];if(second&&Number(second.score||0)>=Number(first.score||0)-0.08)return{db,errorText:`Нашёл несколько вариантов: ${rows.slice(0,4).map((x,i)=>`${i+1}) ${x.title}${x.subtitle?` — ${x.subtitle}`:''}`).join('; ')}. Уточните получателя.`};
  const otherId=first.payload?.user_id||first.entity_id;const {data,error}=await db.rpc('open_direct_chat',{p_other_user_id:otherId});if(error)throw error;return{db,roomId:data,targetName:first.title,otherId}
}
async function send(req,target,body){
  const text=String(body||'').trim();if(!text)return{success:true,handled:true,kind:'message_help',text:'Что именно отправить?'};
  const actor=await currentStaff(req);const room=await roomFor(req,target);if(room.errorText)return{success:true,handled:true,kind:'message_target_choices',text:room.errorText};
  const {data,error}=await room.db.from('messages').insert({room_id:room.roomId,sender_id:actor.user.id,body:text.slice(0,4000)}).select('id,room_id,body,created_at').single();if(error)throw error;
  return{success:true,handled:true,kind:'message_sent',text:`Сообщение отправлено: ${room.targetName}.`,message:data,navigation:{url:'./messages.html',label:'Открыть сообщения'}}
}
function fallbackDraft(raw){let t=String(raw||'').trim().replace(/^[,:;\s-]+/,'');if(!t)t='Спасибо за сообщение. Информацию принял, уточню детали и вернусь с ответом.';t=t.charAt(0).toLocaleUpperCase('ru-RU')+t.slice(1);if(!/[.!?]$/.test(t))t+='.';return t}
async function generateDraft(raw,context='деловая переписка A4PRINT HUB'){
  const c=config();if(!c.jarvisUrl||!c.jarvisKey)return{text:fallbackDraft(raw),model:false};
  try{const r=await fetch(`${c.jarvisUrl}/api/v1/assistant/query`,{method:'POST',headers:{Authorization:`Bearer ${c.jarvisKey}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({text:`Сформулируй только готовый текст сообщения на русском языке, без пояснений. Контекст: ${context}. Смысл или черновик: ${raw}`})});if(!r.ok)throw new Error();const d=await r.json();const t=String(d.text||'').trim();if(!t||/команда принята|модель.*недоступ/i.test(t))throw new Error();return{text:t.slice(0,4000),model:true}}catch{return{text:fallbackDraft(raw),model:false}}
}
async function latestIncoming(req){const actor=await currentStaff(req);const {data,error}=await actor.db.from('messages').select('id,room_id,sender_id,body,created_at').neq('sender_id',actor.user.id).is('deleted_at',null).order('created_at',{ascending:false}).limit(1).maybeSingle();if(error)throw error;if(!data)return null;const {data:sender}=await actor.db.from('users').select('id,full_name,email').eq('id',data.sender_id).maybeSingle();return{...data,sender}}
async function handleMessage(req,text){
  const compose=text.match(/(?:сформулируй|переформулируй|подготовь|напиши\s+черновик)\s+(?:мне\s+)?(?:сообщени(?:е|я)\s*)?(.*)/i);if(compose){const d=await generateDraft(compose[1]||text);return{success:true,handled:true,kind:'message_draft',text:d.text,draft:d.text,generated_by_model:d.model}}
  const last=text.match(/(?:ответь|напиши)\s+(?:на\s+)?последн(?:ее|ий)\s+сообщени(?:е|ю)\s*(?:что|:)?\s*(.+)/i);if(last){const msg=await latestIncoming(req);if(!msg)return{success:true,handled:true,kind:'message_none',text:'Доступных входящих сообщений не нашёл.'};const target=msg.sender?.full_name||msg.sender?.email;if(!target)return{success:true,handled:true,kind:'message_target_not_found',text:'Не смог определить отправителя последнего сообщения.'};return send(req,target,last[1])}
  const general=text.match(/(?:напиши|отправь|скажи)\s+(?:в\s+)?общ(?:ий|ем)\s+(?:чат(?:е|у)?\s*)?(?:что\s+)?(.+)/i);if(general)return send(req,'общий',general[1]);
  const direct=text.match(/(?:напиши|отправь|ответь)\s+([^,:]+?)(?:\s+(?:что|сообщение)\s+|[:,]\s*)(.+)/i);if(direct)return send(req,direct[1].trim(),direct[2].trim());
  return null
}
function systemAction(text){
  if(/(?:открой|начни)\s+(?:кассовую\s+)?смену/i.test(text))return{success:true,handled:true,kind:'system_action',text:'Могу открыть кассовую смену. Нужно подтверждение.',system_action:{type:'api',method:'POST',path:'/api/v1/pos/shift/open',body:{},requires_confirmation:true,confirm_text:'Джарвис откроет кассовую смену. Продолжить?',success_text:'Кассовая смена открыта.'}};
  if(/(?:закрой|заверши)\s+(?:кассовую\s+)?смену/i.test(text))return{success:true,handled:true,kind:'system_action',text:'Могу закрыть кассовую смену. Нужно подтверждение.',system_action:{type:'api',method:'POST',path:'/api/v1/pos/shift/close',body:{},requires_confirmation:true,confirm_text:'Джарвис закроет текущую кассовую смену. Продолжить?',success_text:'Кассовая смена закрыта.'}};
  if(/(?:синхронизируй|обнови|обновить)\s+(?:каталог|мой\s*склад|мойсклад)/i.test(text))return{success:true,handled:true,kind:'system_action',text:'Готов запустить синхронизацию каталога с МойСклад.',system_action:{type:'api',method:'POST',path:'/api/v1/integrations/moysklad/sync',body:{},requires_confirmation:true,confirm_text:'Запустить синхронизацию каталога с МойСклад?',success_text:'Синхронизация завершена.'}};
  return null
}
async function inbox(req){const actor=await currentStaff(req);let q=actor.db.from('messages').select('id,room_id,sender_id,body,created_at').neq('sender_id',actor.user.id).is('deleted_at',null).order('created_at',{ascending:false}).limit(10);const after=String(req.query.after||'').trim();if(after)q=q.gt('created_at',after);const {data,error}=await q;if(error)throw error;const rows=data||[];const ids=[...new Set(rows.map(x=>x.sender_id).filter(Boolean))];let people=[];if(ids.length){const r=await actor.db.from('users').select('id,full_name,email').in('id',ids);if(r.error)throw r.error;people=r.data||[]}const byId=new Map(people.map(x=>[x.id,x]));return rows.map(x=>({...x,users:byId.get(x.sender_id)||null}))}
async function draftFor(req){const id=String(req.body?.message_id||'').trim();if(!id)throw Object.assign(new Error('MESSAGE_ID_REQUIRED'),{status:400});const actor=await currentStaff(req);const {data,error}=await actor.db.from('messages').select('id,room_id,sender_id,body,created_at').eq('id',id).is('deleted_at',null).maybeSingle();if(error)throw error;if(!data)throw Object.assign(new Error('MESSAGE_NOT_FOUND'),{status:404});const {data:sender}=await actor.db.from('users').select('id,full_name,email').eq('id',data.sender_id).maybeSingle();const name=sender?.full_name||sender?.email||'сотрудник';const d=await generateDraft(`Ответь на сообщение: «${data.body}»`,`переписка с ${name}; ответ краткий, деловой и полезный`);return{success:true,message:{...data,users:sender},draft:d.text,generated_by_model:d.model,can_auto_send:d.model}}
async function sendDraft(req){const d=await draftFor(req);if(!d.generated_by_model&&req.body?.allow_fallback!==true)return{...d,sent:false,warning:'MODEL_REQUIRED_FOR_AUTO_SEND'};const target=d.message.users?.full_name||d.message.users?.email;if(!target)throw new Error('SENDER_NOT_FOUND');const result=await send(req,target,d.draft);return{...result,generated_by_model:d.generated_by_model,source_message_id:d.message.id,sent:true}}

express.application.listen=function patchedJarvisControlListen(...args){
  if(!this[installed]){this[installed]=true;
    this.post('/api/v1/jarvis/query',requireSession,async(req,res,next)=>{try{const text=clean(req.body?.text);const control=systemAction(text);if(control)return res.json(control);const message=await handleMessage(req,text);if(message)return res.json(message);next()}catch(error){console.error('[Jarvis control]',error);return res.status(error.status||500).json({success:false,handled:true,error:String(error.message||error)})}});
    this.get('/api/v1/jarvis/bot/inbox',requireSession,async(req,res)=>{try{return res.json({success:true,messages:await inbox(req)})}catch(error){return res.status(error.status||500).json({success:false,error:String(error.message||error)})}});
    this.post('/api/v1/jarvis/bot/draft',requireSession,async(req,res)=>{try{return res.json(await draftFor(req))}catch(error){return res.status(error.status||500).json({success:false,error:String(error.message||error)})}});
    this.post('/api/v1/jarvis/bot/send',requireSession,async(req,res)=>{try{return res.json(await sendDraft(req))}catch(error){return res.status(error.status||500).json({success:false,error:String(error.message||error)})}});
  }
  return originalListen.apply(this,args)
};
