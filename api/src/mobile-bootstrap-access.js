import express from 'express';

const installed=Symbol.for('a4print.mobile.bootstrap.access.installed');
const orderRoles=new Set(['ADMIN','MANAGER','WAREHOUSE','PRODUCTION','VIEWER']);

function canReadOrders(body){
  const roles=Array.isArray(body?.profile?.roles)?body.profile.roles:[];
  return roles.some(role=>orderRoles.has(String(role||'').toUpperCase()));
}

const originalGet=express.application.get;
express.application.get=function patchedMobileBootstrapGet(path,...handlers){
  if(path==='/api/v1/mobile/bootstrap'&&handlers.length&&!this[installed]){
    this[installed]=true;
    const index=handlers.length-1;
    const originalHandler=handlers[index];
    handlers[index]=async function scopedMobileBootstrap(req,res,next){
      const originalJson=res.json.bind(res);
      res.json=function scopedJson(body){
        if(body?.success&&body?.profile&&!canReadOrders(body)){
          return originalJson({...body,orders:[]});
        }
        return originalJson(body);
      };
      return originalHandler(req,res,next);
    };
  }
  return originalGet.call(this,path,...handlers);
};
