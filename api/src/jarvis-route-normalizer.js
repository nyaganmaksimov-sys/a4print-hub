import express from 'express';

const installed=Symbol.for('a4print.jarvis.route.normalizer.installed');
const originalListen=express.application.listen;

function normalizeUrl(raw){
  const value=String(raw||'').trim();
  if(!value)return value;
  if(value==='../kassa/'||value==='./kassa/'||value==='/kassa')return '/kassa/';
  if(value.startsWith('./'))return `/admin/${value.slice(2)}`;
  return value;
}

function normalizePayload(payload){
  if(!payload||typeof payload!=='object')return payload;
  if(payload.system_action?.url)payload.system_action.url=normalizeUrl(payload.system_action.url);
  if(payload.navigation?.url)payload.navigation.url=normalizeUrl(payload.navigation.url);
  if(Array.isArray(payload.results))for(const item of payload.results)if(item?.route)item.route=normalizeUrl(item.route);
  return payload;
}

express.application.listen=function patchedJarvisRouteNormalizerListen(...args){
  if(!this[installed]){
    this[installed]=true;
    this.post('/api/v1/jarvis/query',(req,res,next)=>{
      const originalJson=res.json.bind(res);
      res.json=payload=>originalJson(normalizePayload(payload));
      next();
    });
  }
  return originalListen.apply(this,args);
};
