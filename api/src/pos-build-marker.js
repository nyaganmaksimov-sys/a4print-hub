import express from 'express';

const renderCommit=String(process.env.RENDER_GIT_COMMIT||'').trim();
const BUILD=renderCommit?`git-${renderCommit.slice(0,12)}`:'local';
const originalGet=express.application.get;
let added=false;

express.application.get=function patchedGet(path,...handlers){
  if(!added){
    added=true;
    originalGet.call(this,'/api/v1/pos/build',(_req,res)=>res.json({
      success:true,
      posBuild:BUILD,
      shiftSource:'moysklad-direct',
      shiftSanity:true,
      freshManualShift:true,
      shiftIdSummary:true,
      paymentBreakdown:true,
      saleIdempotency:true,
      cashOperations:true,
      receiptQueueRecovery:true
    }));
  }
  return originalGet.call(this,path,...handlers);
};
