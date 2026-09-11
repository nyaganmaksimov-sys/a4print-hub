import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';

const installed = Symbol.for('a4print.jarvis.incident.ops.installed');
const workerInstalled = Symbol.for('a4print.jarvis.incident.ops.worker.installed');
const originalListen = express.application.listen;
const supabaseUrl=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const publishableKey=String(process.env.SUPABASE_PUBLISHABLE_KEY||'');
const serviceKey=String(process.env.SUPABASE_SERVICE_ROLE_KEY||'');
const service=supabaseUrl&&serviceKey?createClient(supabaseUrl,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}}):null;
const INTERVAL_MS=Math.max(45_000,Number(process.env.JARVIS_INCIDENT_TASK_INTERVAL_MS||90_000));
const state={running:false,runs:0,created:0,completed:0,last_run_at:null,last_error:null};
const upper=v=>String(v||'').trim().toUpperCase();
const compact=(v,max=5000)=>String(v||'').replace(/\s+/g,' ').trim().slice(0,max);
const nowIso=()=>new Date().toISOString();

function scopedDb(token){return supabaseUrl&&publishableKey?createClient(supabaseUrl,publishableKey,{auth:{autoRefreshToken:false,persistSession:false},global:{headers:{Authorization:`Bearer ${token}`}}}):null;}
async function requireSession(req,res,next){
  try{
    const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
    if(!token)return res.status(401).json({success:false,error:'AUTH_REQUIRED'});
    const response=await fetch(`${supabaseUrl}/auth/v1/user`,{headers:{Authorization:`Bearer ${token}`,apikey:publishableKey}});
    if(!response.ok)return res.status(401).json({success:false,error:'INVALID_SESSION'});
    req.incidentAuth=await response.json();req.incidentDb=scopedDb(token);return next();
  }catch(error){return next(error)}
}
async function viewer(req){
  if(!service||!req.incidentDb)throw Object.assign(new Error('DATABASE_NOT_CONFIGURED'),{status:503});
  const {data:user,error}=await service.from('users').select('id,full_name,is_active,organization_unit_id').eq('auth_user_id',String(req.incidentAuth?.id||'')).maybeSingle();
  if(error)throw error;if(!user||user.is_active===false)throw Object.assign(new Error('STAFF_PROFILE_REQUIRED'),{status:403});
  const {data:roleRows,error:roleError}=await req.incidentDb.rpc('get_my_roles');if(roleError)throw roleError;
  const roles=(Array.isArray(roleRows)?roleRows:[]).map(x=>upper(typeof x==='string'?x:x?.role||x?.name||x));
  let organizationId=null;if(user.organization_unit_id){const {data:unit}=await service.from('organization_units').select('organization_id').eq('id',user.organization_unit_id).maybeSingle();organizationId=unit?.organization_id||null;}
  if(!organizationId){const {data:org}=await service.from('organizations').select('id').eq('code','A4PRINT').maybeSingle();organizationId=org?.id||null;}
  return{user,roles,organizationId,isAdmin:roles.includes('ADMIN')};
}
function canSee(v,incident){return v.isAdmin||Boolean(v.organizationId&&incident.organization_id===v.organizationId)}

async function managerCandidates(organizationId){
  const {data:roleDefs,error:rdErr}=await service.from('roles').select('id,name').in('name',['ADMIN','MANAGER']);if(rdErr)throw rdErr;
  const ids=(roleDefs||[]).map(x=>x.id);if(!ids.length)return[];
  const {data:ur,error:urErr}=await service.from('user_roles').select('user_id,role_id').in('role_id',ids);if(urErr)throw urErr;
  const userIds=[...new Set((ur||[]).map(x=>x.user_id).filter(Boolean))];if(!userIds.length)return[];
  const {data:users,error:uErr}=await service.from('users').select('id,full_name,organization_unit_id,is_active,created_at').in('id',userIds).eq('is_active',true).order('created_at');if(uErr)throw uErr;
  if(!organizationId)return users||[];
  const unitIds=[...new Set((users||[]).map(x=>x.organization_unit_id).filter(Boolean))];
  const {data:units,error:unitErr}=unitIds.length?await service.from('organization_units').select('id,organization_id').in('id',unitIds):{data:[],error:null};if(unitErr)throw unitErr;
  const orgByUnit=new Map((units||[]).map(x=>[x.id,x.organization_id]));
  return (users||[]).filter(x=>orgByUnit.get(x.organization_unit_id)===organizationId);
}
async function findAssignee(incident){
  const ev=incident.evidence||{};
  const orderId=ev.order_id||(ev.entity_type==='order'?ev.entity_id:null);
  if(orderId){const {data:order}=await service.from('orders').select('assigned_to').eq('id',orderId).maybeSingle();if(order?.assigned_to)return order.assigned_to;}
  const candidates=await managerCandidates(incident.organization_id);return candidates[0]?.id||null;
}
async function pastResolution(incident){
  const {data,error}=await service.from('jarvis_incident_resolutions').select('resolution_text,created_at').eq('organization_id',incident.organization_id).eq('kind',incident.kind).order('created_at',{ascending:false}).limit(1);if(error)throw error;return data?.[0]||null;
}
async function notify(userId,title,body,entityId){if(!userId)return;const {error}=await service.from('notifications').insert({user_id:userId,title:compact(title,300),body:compact(body,2000)||null,type:'SENTINEL_TASK',entity_type:'jarvis_task',entity_id:entityId});if(error)throw error;}

async function ensureIncidentTask(incident){
  const {data:existing,error:eErr}=await service.from('jarvis_tasks').select('id,status,assigned_to').eq('source','SENTINEL').contains('metadata',{incident_id:incident.id,auto_created:true}).limit(1);if(eErr)throw eErr;
  if(existing?.length)return existing[0];
  const assignee=await findAssignee(incident);const learned=await pastResolution(incident);
  const suggested=Array.isArray(incident.suggested_actions)?incident.suggested_actions.map(x=>x?.note||x?.label).filter(Boolean).slice(0,4):[];
  const description=[incident.detail,suggested.length?`Рекомендованные проверки: ${suggested.join(' • ')}`:'',learned?.resolution_text?`Подтверждённый опыт по похожей проблеме: ${compact(learned.resolution_text,1200)}`:''].filter(Boolean).join('\n\n');
  const dueMs=incident.severity==='critical'?2*3600000:8*3600000;
  const payload={organization_id:incident.organization_id,title:`Sentinel: ${compact(incident.title,460)}`,description,status:'TODO',priority:incident.severity==='critical'?'URGENT':'HIGH',due_at:new Date(Date.now()+dueMs).toISOString(),created_by:null,assigned_to:assignee,source:'SENTINEL',metadata:{incident_id:incident.id,fingerprint:incident.fingerprint,kind:incident.kind,auto_created:true,learned_resolution:Boolean(learned)}};
  const {data,error}=await service.from('jarvis_tasks').insert(payload).select('id,title,status,priority,due_at,assigned_to').single();if(error)throw error;
  state.created+=1;if(assignee)await notify(assignee,'Новая задача от Sentinel',`${incident.title}. Приоритет: ${payload.priority}.`,data.id);return data;
}
async function completeResolvedTasks(){
  const {data:tasks,error}=await service.from('jarvis_tasks').select('id,status,metadata').eq('source','SENTINEL').in('status',['TODO','IN_PROGRESS']).limit(1000);if(error)throw error;
  const ids=[...new Set((tasks||[]).map(t=>t.metadata?.incident_id).filter(Boolean))];if(!ids.length)return;
  const {data:incidents,error:iErr}=await service.from('jarvis_incidents').select('id,status').in('id',ids);if(iErr)throw iErr;
  const statusById=new Map((incidents||[]).map(x=>[x.id,x.status]));
  for(const task of tasks||[]){if(statusById.get(task.metadata?.incident_id)!=='RESOLVED')continue;const {error:uErr}=await service.from('jarvis_tasks').update({status:'DONE',completed_at:nowIso(),updated_at:nowIso()}).eq('id',task.id);if(uErr)throw uErr;state.completed+=1;}
}
async function runIncidentTasks(){
  if(state.running||!service)return;state.running=true;
  try{
    const {data:incidents,error}=await service.from('jarvis_incidents').select('id,organization_id,fingerprint,kind,severity,title,detail,suggested_actions,evidence,status,last_seen_at').in('status',['OPEN','ACK']).in('severity',['warning','critical']).order('last_seen_at',{ascending:false}).limit(200);if(error)throw error;
    for(const incident of incidents||[]){try{await ensureIncidentTask(incident)}catch(error){console.warn('[Sentinel task]',incident.id,error?.message||error)}}
    await completeResolvedTasks();state.runs+=1;state.last_run_at=nowIso();state.last_error=null;
  }catch(error){state.last_run_at=nowIso();state.last_error=String(error.message||error);console.error('[Sentinel task worker]',error)}finally{state.running=false}
}

async function memory(req,res){
  try{const v=await viewer(req);const {data:incident,error}=await service.from('jarvis_incidents').select('id,organization_id,kind,title,fingerprint').eq('id',req.params.id).maybeSingle();if(error)throw error;if(!incident)return res.status(404).json({success:false,error:'INCIDENT_NOT_FOUND'});if(!canSee(v,incident))return res.status(403).json({success:false,error:'FORBIDDEN'});
    const {data,error:mErr}=await service.from('jarvis_incident_resolutions').select('id,title,resolution_text,created_at,problem_signature').eq('organization_id',incident.organization_id).eq('kind',incident.kind).neq('incident_id',incident.id).order('created_at',{ascending:false}).limit(8);if(mErr)throw mErr;return res.json({success:true,items:data||[]});
  }catch(error){return res.status(error.status||500).json({success:false,error:String(error.message||error)})}
}
async function resolveWithNote(req,res){
  try{const v=await viewer(req);const resolution=compact(req.body?.resolution,6000);if(resolution.length<3)return res.status(400).json({success:false,error:'RESOLUTION_REQUIRED'});
    const {data:incident,error}=await service.from('jarvis_incidents').select('*').eq('id',req.params.id).maybeSingle();if(error)throw error;if(!incident)return res.status(404).json({success:false,error:'INCIDENT_NOT_FOUND'});if(!canSee(v,incident))return res.status(403).json({success:false,error:'FORBIDDEN'});
    const {data:ai}=await service.from('jarvis_incident_ai').select('analysis,sources,provider,model,generated_at').eq('incident_id',incident.id).maybeSingle();
    const snapshot=ai?{analysis:ai.analysis||'',sources:ai.sources||[],provider:ai.provider||null,model:ai.model||null,generated_at:ai.generated_at||null}:{};
    const payload={incident_id:incident.id,organization_id:incident.organization_id,kind:incident.kind,title:incident.title,problem_signature:incident.fingerprint,resolution_text:resolution,resolved_by:v.user.id,analysis_snapshot:snapshot};
    const {data:memoryRow,error:memErr}=await service.from('jarvis_incident_resolutions').upsert(payload,{onConflict:'incident_id'}).select('*').single();if(memErr)throw memErr;
    const resolvedAt=nowIso();const {data:resolved,error:rErr}=await service.from('jarvis_incidents').update({status:'RESOLVED',resolved_at:resolvedAt}).eq('id',incident.id).select('*').single();if(rErr)throw rErr;
    await service.from('jarvis_tasks').update({status:'DONE',completed_at:resolvedAt,updated_at:resolvedAt}).eq('source','SENTINEL').contains('metadata',{incident_id:incident.id,auto_created:true}).in('status',['TODO','IN_PROGRESS']);
    return res.json({success:true,incident:resolved,memory:{id:memoryRow.id,resolution_text:memoryRow.resolution_text,created_at:memoryRow.created_at}});
  }catch(error){return res.status(error.status||500).json({success:false,error:String(error.message||error)})}
}
function installWorker(){if(globalThis[workerInstalled]||!service)return;globalThis[workerInstalled]=true;const first=setTimeout(runIncidentTasks,16_000);first.unref?.();const timer=setInterval(runIncidentTasks,INTERVAL_MS);timer.unref?.();}
express.application.listen=function patchedIncidentOpsListen(...args){if(!this[installed]){this[installed]=true;this.get('/api/v1/jarvis/incidents/:id/memory',requireSession,memory);this.post('/api/v1/jarvis/incidents/:id/resolve-with-note',requireSession,resolveWithNote);this.get('/api/v1/jarvis/incident-task-status',requireSession,async(req,res)=>{try{const v=await viewer(req);if(!v.isAdmin)return res.status(403).json({success:false,error:'ADMIN_REQUIRED'});return res.json({success:true,worker:{...state,interval_ms:INTERVAL_MS}})}catch(error){return res.status(error.status||500).json({success:false,error:String(error.message||error)})}})}installWorker();return originalListen.apply(this,args)};
export{runIncidentTasks};
