import express from 'express';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl=process.env.SUPABASE_URL;
const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
const selftestToken=String(process.env.PARTNER_SELFTEST_TOKEN||'');
const service=supabaseUrl&&serviceKey?createClient(supabaseUrl,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}}):null;
const installed=Symbol.for('a4print.partner.selftest.installed');
const originalListen=express.application.listen;

function ok(step,detail={}){return{step,ok:true,...detail}}
function bad(step,error){return{step,ok:false,error:String(error?.message||error)}}

express.application.listen=function patchedPartnerSelftestListen(...args){
  if(!this[installed]){
    this[installed]=true;
    this.get('/api/v1/_selftest/partner-registration',async(req,res)=>{
      res.setHeader('Cache-Control','no-store');
      if(!selftestToken||String(req.query?.token||'')!==selftestToken)return res.status(404).json({success:false,error:'NOT_FOUND'});
      if(!service)return res.status(503).json({success:false,error:'DATABASE_NOT_CONFIGURED'});

      const runId=`${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const inviteToken=crypto.randomBytes(24).toString('base64url');
      const email=`a4print-partner-e2e-${runId}@example.com`;
      const password=`A4!${crypto.randomBytes(12).toString('base64url')}9z`;
      const company=`TEST Partner E2E ${runId}`;
      const contact='TEST Partner Operator';
      const discount=12.5;
      const paymentTerms=21;
      const steps=[];
      let inviteId=null;
      let partnerId=null;
      let partnerUserId=null;
      let authUserId=null;

      const base=`http://127.0.0.1:${process.env.PORT||3000}`;
      try{
        const inviteInsert=await service.from('partner_registration_invites').insert({
          token:inviteToken,label:`TEST E2E ${runId}`,
          default_discount_percent:discount,default_payment_terms_days:paymentTerms,
          max_uses:1,used_count:0,is_active:true,
          expires_at:new Date(Date.now()+60*60*1000).toISOString()
        }).select('id').single();
        if(inviteInsert.error)throw inviteInsert.error;
        inviteId=inviteInsert.data.id;
        steps.push(ok('invite_created',{invite_id:inviteId}));

        const infoRes=await fetch(`${base}/api/v1/partner-registration/${encodeURIComponent(inviteToken)}`,{headers:{accept:'application/json'}});
        const info=await infoRes.json().catch(()=>({}));
        if(!infoRes.ok)throw new Error(`invite info HTTP ${infoRes.status}: ${info.message||info.error||''}`);
        if(Number(info.invite?.discount_percent)!==discount||Number(info.invite?.payment_terms_days)!==paymentTerms)throw new Error('invite defaults mismatch');
        steps.push(ok('invite_public_check',{discount_percent:Number(info.invite.discount_percent),payment_terms_days:Number(info.invite.payment_terms_days),remaining_uses:Number(info.invite.remaining_uses)}));

        const regRes=await fetch(`${base}/api/v1/partner-registration/${encodeURIComponent(inviteToken)}`,{
          method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({
            company_name:company,legal_name:`ООО ${company}`,tax_id:'0000000000',contact_name:contact,
            phone:'+70000000000',email,password,accepted_terms:true
          })
        });
        const reg=await regRes.json().catch(()=>({}));
        if(regRes.status!==201||!reg.success)throw new Error(`registration HTTP ${regRes.status}: ${reg.message||reg.error||''}`);
        partnerId=reg.partner?.id||null;
        steps.push(ok('registration_created',{partner_id:partnerId,login_url:reg.login_url||null}));

        const signIn=await service.auth.signInWithPassword({email,password});
        if(signIn.error||!signIn.data?.user)throw signIn.error||new Error('sign in returned no user');
        authUserId=signIn.data.user.id;
        steps.push(ok('password_login',{auth_user_id:authUserId,session_created:Boolean(signIn.data.session)}));

        const relation=await service.from('partner_users').select('id,partner_id,auth_user_id,full_name,email,is_admin,is_active,partners(id,name,discount_percent,payment_terms_days,is_active)').eq('auth_user_id',authUserId).single();
        if(relation.error)throw relation.error;
        partnerUserId=relation.data.id;
        partnerId=partnerId||relation.data.partner_id;
        const partner=relation.data.partners;
        if(!partner||Number(partner.discount_percent)!==discount||Number(partner.payment_terms_days)!==paymentTerms||partner.is_active!==true)throw new Error('partner CRM relationship/defaults mismatch');
        steps.push(ok('partner_crm_link',{partner_user_id:partnerUserId,is_admin:relation.data.is_admin,is_active:relation.data.is_active,discount_percent:Number(partner.discount_percent),payment_terms_days:Number(partner.payment_terms_days)}));

        const inviteCheck=await service.from('partner_registration_invites').select('used_count,max_uses,is_active,last_used_at').eq('id',inviteId).single();
        if(inviteCheck.error)throw inviteCheck.error;
        const useCheck=await service.from('partner_registration_invite_uses').select('id,partner_id,partner_user_id,registered_email,company_name').eq('invite_id',inviteId).single();
        if(useCheck.error)throw useCheck.error;
        if(Number(inviteCheck.data.used_count)!==1||useCheck.data.partner_id!==partnerId||useCheck.data.partner_user_id!==partnerUserId)throw new Error('invite usage was not recorded correctly');
        steps.push(ok('invite_usage_recorded',{used_count:Number(inviteCheck.data.used_count),max_uses:Number(inviteCheck.data.max_uses)}));

        const secondRes=await fetch(`${base}/api/v1/partner-registration/${encodeURIComponent(inviteToken)}`,{headers:{accept:'application/json'}});
        const second=await secondRes.json().catch(()=>({}));
        if(secondRes.status!==410||second.error!=='INVITE_LIMIT_REACHED')throw new Error(`single-use guard mismatch: HTTP ${secondRes.status} ${second.error||''}`);
        steps.push(ok('single_use_guard',{status:secondRes.status,error:second.error}));

        return res.json({success:true,run_id:runId,steps,cleanup:'scheduled'});
      }catch(error){
        steps.push(bad('selftest_failed',error));
        return res.status(500).json({success:false,run_id:runId,steps,error:String(error?.message||error),cleanup:'scheduled'});
      }finally{
        try{if(inviteId)await service.from('partner_registration_invite_uses').delete().eq('invite_id',inviteId)}catch{}
        try{if(partnerUserId)await service.from('partner_users').delete().eq('id',partnerUserId)}catch{}
        try{if(partnerId)await service.from('partners').delete().eq('id',partnerId)}catch{}
        try{if(authUserId)await service.auth.admin.deleteUser(authUserId)}catch{}
        try{if(inviteId)await service.from('partner_registration_invites').delete().eq('id',inviteId)}catch{}
      }
    });
  }
  return originalListen.apply(this,args);
};
