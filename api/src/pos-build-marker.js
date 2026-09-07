import express from 'express';

const BUILD='20260907-shiftfresh1';
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
      saleIdempotency:true
    }));
  }
  return originalGet.call(this,path,...handlers);
};
