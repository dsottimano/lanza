import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest as signIn } from '../functions/admin/api/auth/device/poll.ts';
import { onRequest as logout } from '../functions/admin/api/auth/logout.ts';
import { onRequest as agentPoll } from '../functions/admin/api/auth/agent/poll.ts';
import { authCookies } from '../functions/_lib/device-flow.ts';
const initial=()=>new Map([['lanza_gh','old-access'],['lanza_gh_refresh','old-refresh'],['lanza_gh_device','sign-in-code'],['lanza_agent_device','old-agent-code']]);
function applyCookies(jar,response) {
 for(const set of response.headers.getSetCookie()) {
  const [pair]=set.split(';');const at=pair.indexOf('=');const key=pair.slice(0,at),value=pair.slice(at+1);
  if(set.includes('Max-Age=0'))jar.delete(key);else jar.set(key,value);
 }
}
const cookieHeader=jar=>[...jar].map(([k,v])=>`${k}=${v}`).join('; ');
async function assertAgentRestart(t,jar) {
 const fetcher=t.mock.method(globalThis,'fetch',async()=>{throw Error('Must not redeem an old authorization');});
 const response=await agentPoll({request:new Request('https://lanzacms.com/admin/api/auth/agent/poll',{method:'POST',headers:{Cookie:cookieHeader(jar)}}),env:{},data:{role:'owner'}});
 assert.equal(response.status,400);assert.equal((await response.json()).status,'restart');
 assert.equal(fetcher.mock.callCount(),0);
}
test('logout clears the pending agent authorization along with the session',async t=>{
 const jar=initial();
 const response=await logout({request:new Request('https://lanzacms.com/admin/api/auth/logout',{headers:{Cookie:cookieHeader(jar)}})});
 assert.equal(response.status,302);assert.equal(response.headers.get('cache-control'),'no-store');
 applyCookies(jar,response);assert.equal(jar.size,0);
 await assertAgentRestart(t,jar);
});
for(const rotating of [true,false]) test(`new sign-in replaces account credentials and pending agent flow (refresh token: ${rotating})`,async t=>{
 const jar=initial();
 t.mock.method(globalThis,'fetch',async()=>Response.json({access_token:'new-access',...(rotating?{refresh_token:'new-refresh'}:{})}));
 const response=await signIn({request:new Request('https://lanzacms.com/admin/api/auth/device/poll',{method:'POST',headers:{Cookie:cookieHeader(jar)}}),env:{}});
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{status:'ok'});
 applyCookies(jar,response);
 assert.equal(jar.get('lanza_gh'),'new-access');assert.equal(jar.get('lanza_gh_refresh'),rotating?'new-refresh':undefined);
 assert.equal(jar.has('lanza_gh_device'),false);assert.equal(jar.has('lanza_agent_device'),false);
 await assertAgentRestart(t,jar);
});
test('ordinary token refresh leaves an in-progress agent flow intact',()=>{
 const jar=initial();const headers=new Headers();
 for(const value of authCookies({accessToken:'refreshed-access',expiresIn:100,refreshToken:'refreshed-refresh'}))headers.append('set-cookie',value);
 applyCookies(jar,new Response(null,{headers}));
 assert.equal(jar.get('lanza_agent_device'),'old-agent-code');
 assert.equal(jar.get('lanza_gh'),'refreshed-access');
});
