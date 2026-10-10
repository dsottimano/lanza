import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identityFor, resetIdentityCache } from '../functions/_lib/gh-identity.ts';
import { onRequest } from '../functions/admin/_middleware.ts';
test.beforeEach(resetIdentityCache);
const owner=()=>Response.json({permissions:{admin:true},login:'fixture-owner'});
for(const [name,reply] of [
 ['primary limit',()=>Response.json({message:'Forbidden'},{status:403,headers:{'x-ratelimit-remaining':'0'}})],
 ['retry-after',()=>Response.json({message:'Forbidden'},{status:403,headers:{'retry-after':'60'}})],
 ['secondary limit',()=>Response.json({message:'You have exceeded a secondary rate limit.'},{status:403})],
 ['429',()=>Response.json({message:'Too many requests'},{status:429})],
]) test(`${name} is unavailable, not a cached access denial`,async()=>{
 let limited=true;
 const fetcher=async url=>String(url).includes('/repos/')&&limited?reply():owner();
 assert.deepEqual(await identityFor('fake-token','o','r',fetcher),{status:'unavailable'});
 limited=false;
 assert.equal((await identityFor('fake-token','o','r',fetcher)).status,'ok');
});
test('a repository owner role cannot authorize another repository through the cache',async()=>{
 const calls=[];
 const fetcher=async url=>{calls.push(url);return String(url).includes('/repos/other/private')?Response.json({},{status:404}):owner();};
 assert.equal((await identityFor('same-token','o','owned',fetcher)).identity.role,'owner');
 assert.equal((await identityFor('same-token','other','private',fetcher)).status,'denied');
 assert.equal(calls.length,4);
 assert.equal((await identityFor('same-token','O','OWNED',fetcher)).status,'ok');
 assert.equal(calls.length,4);
});
test('a cached denial for one repository does not deny another',async()=>{
 const fetcher=async url=>String(url).includes('/repos/o/denied')?Response.json({},{status:404}):owner();
 assert.equal((await identityFor('same-token','o','denied',fetcher)).status,'denied');
 assert.equal((await identityFor('same-token','o','owned',fetcher)).status,'ok');
});
test('the real gate refuses throttled checks without clearing cookies or running downstream',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({message:'Rate limit exceeded'},{status:403,headers:{'x-ratelimit-remaining':'0'}}));
 let reached=false;
 const response=await onRequest({request:new Request('https://lanzacms.com/admin/api/gh/user',{headers:{Cookie:'lanza_gh=fixture-token'}}),env:{},next:async()=>{reached=true;return new Response('unsafe');}});
 assert.equal(response.status,503);assert.equal(reached,false);assert.equal(response.headers.get('set-cookie'),null);
});
