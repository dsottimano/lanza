import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/admin/_middleware.ts';
import { resetIdentityCache } from '../functions/_lib/gh-identity.ts';
import { refreshTokens } from '../functions/_lib/device-flow.ts';

async function gate(t, refreshReply, identity = 'owner') {
 resetIdentityCache();
 let reached = false;
 t.mock.method(globalThis,'fetch',async (url,init)=>{
  if(String(url).includes('/login/oauth/')) return refreshReply();
  assert.equal(init.headers.Authorization,'Bearer fresh-access');
  if(String(url).endsWith('/user')) return Response.json({login:'fixture-owner'});
  if(identity==='denied') return Response.json({message:'Not Found'},{status:404});
  if(identity==='unavailable') return Response.json({message:'Unavailable'},{status:503});
  return Response.json({permissions:{admin:true,push:true,pull:true}});
 });
 const context={request:new Request('https://lanzacms.com/admin/api/gh/user',{headers:{Cookie:'lanza_gh_refresh=fixture-refresh'}}),env:{},data:{},next:async()=>{reached=true;return new Response('allowed');}};
 const response=await onRequest(context);
 return {response,reached,context};
}
for(const [name,reply] of [
 ['network exception',()=>{throw new Error('Network failed');}],
 ['non-JSON outage',()=>new Response('unavailable',{status:503})],
 ['JSON outage',()=>Response.json({error:'bad_refresh_token'},{status:503})],
 ['throttling',()=>Response.json({error:'bad_refresh_token'},{status:429})],
 ['malformed null',()=>Response.json(null)],
 ['malformed array',()=>Response.json([])],
 ['missing token',()=>Response.json({})],
 ['configuration error',()=>Response.json({error:'incorrect_client_credentials'},{status:400})],
 ['pending response',()=>Response.json({error:'slow_down'})],
]) test(`refresh ${name} refuses downstream with 503 and preserves cookies`,async t=>{
 const {response,reached}=await gate(t,reply);
 assert.equal(response.status,503);assert.equal(reached,false);
 assert.equal(response.headers.get('set-cookie'),null);
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.ok(response.headers.get('content-security-policy'));
});
for(const status of [200,400]) test(`explicit bad refresh token (${status}) clears cookies and refuses access`,async t=>{
 const {response,reached}=await gate(t,()=>Response.json({error:'bad_refresh_token'},{status}));
 assert.equal(response.status,401);assert.equal(reached,false);
 const cookies=response.headers.getSetCookie();
 assert.equal(cookies.length,3);assert.ok(cookies.every(c=>c.includes('Max-Age=0')));
});
for(const status of [400,500]) test(`an HTTP ${status} body cannot issue tokens`,async()=>{
 const result=await refreshTokens('client','refresh',async()=>Response.json({access_token:'do-not-use'},{status}));
 assert.equal(result.status,'error');
});
for(const identity of ['owner','denied','unavailable']) test(`rotated tokens are checked for repository access: ${identity}`,async t=>{
 const {response,reached,context}=await gate(t,()=>Response.json({access_token:'fresh-access',refresh_token:'fresh-refresh',expires_in:28800}),identity);
 assert.equal(response.status,{owner:200,denied:403,unavailable:503}[identity]);
 assert.equal(reached,identity==='owner');
 assert.ok(response.headers.getSetCookie().some(c=>c.startsWith('lanza_gh_refresh=fresh-refresh;')));
 if(identity==='owner') assert.equal(context.data.token,'fresh-access');
 assert.doesNotMatch(await response.text(),/fresh-access|fresh-refresh/);
});
