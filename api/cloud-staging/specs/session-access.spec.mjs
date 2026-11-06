import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,createLocalJWKSet,SignJWT} from 'jose';
import {authorizeSession,verifyJWT} from '../auth-session.js';

const issuer='https://example.neonauth.test';
const uid='3d38d9af-7b84-4a12-80e3-2012167c0c6d';

async function signer() {
  const {publicKey,privateKey}=await generateKeyPair('EdDSA',{extractable:true});
  const jwk=await exportJWK(publicKey); jwk.kid='test';
  const keys=createLocalJWKSet({keys:[jwk]});
  const sign=(options={})=>new SignJWT({sub:options.sub||uid,role:'ADMIN'})
    .setProtectedHeader({alg:'EdDSA',kid:'test'})
    .setIssuer(options.issuer||issuer).setIssuedAt()
    .setExpirationTime(options.expiration||'2m').sign(privateKey);
  return {keys,sign};
}
test('missing and malformed Authorization denied before querying SQL',async()=>{
  for(const authorization of ['', 'Basic x', 'Bearer ', 'Bearer a/b']) {
    const r=await authorizeSession({authorization,verify:()=>{throw Error('should not verify')},pool:{query(){throw Error('should not query')}}});
    assert.equal(r.status,401);
  }
});
test('valid signed JWT with explicit synthetic grant gets viewer-only access',async()=>{
  const {keys,sign}=await signer();const token=await sign();
  const pool={query(sql,args){
    assert.match(sql,/cloud_staging_session_grants/);assert.equal(args[0],uid);
    return {rows:[{role:'STAGING_VIEWER',enabled:true,identity_verified:true}]};
  }};
  const r=await authorizeSession({authorization:'Bearer '+token,verify:t=>verifyJWT(t,keys,issuer),pool});
  assert.equal(r.status,200);
  assert.deepEqual(r.result.permissions,['cloud.taxonomy.read']);
  assert.equal(r.result.productionAccess,false);
  assert.equal(r.result.posSalesEnabled,false);
  assert.ok(!JSON.stringify(r.result).includes('ADMIN'));
});
test('valid JWT cannot bypass disabled/unverified/unknown role',async()=>{
  const {keys,sign}=await signer();const token=await sign();
  const states=[null,{role:'STAGING_VIEWER',enabled:false,identity_verified:true},
    {role:'STAGING_VIEWER',enabled:true,identity_verified:false},
    {role:'ADMIN',enabled:true,identity_verified:true}];
  for(const row of states) {
    const pool={query:async()=>({rows:row?[row]:[]})};
    const r=await authorizeSession({authorization:'Bearer '+token,verify:t=>verifyJWT(t,keys,issuer),pool});
    assert.equal(r.status,403);
  }
});
test('wrong issuer, expired and modified JWT rejected',async()=>{
  const {keys,sign}=await signer();
  const verify=t=>verifyJWT(t,keys,issuer),pool={query(){throw Error('should not query')}};
  const tok1=await sign({issuer:'https://other.neonauth.test'});
  const tok2=await sign({expiration:'-10m'});
  const tok3=await sign();
  for(const token of [tok1,tok2,tok3.slice(0,-3)+'xyz']) {
    const r=await authorizeSession({authorization:'Bearer '+token,verify,pool});
    assert.equal(r.status,401);
  }
});
test('SQL failures fail closed without leaking token',async()=>{
  const {keys,sign}=await signer();const token=await sign();
  const r=await authorizeSession({authorization:'Bearer '+token,
    verify:t=>verifyJWT(t,keys,issuer),pool:{query(){throw Error('offline')}}});
  assert.equal(r.status,503);assert.ok(!JSON.stringify(r).includes(token));
});
