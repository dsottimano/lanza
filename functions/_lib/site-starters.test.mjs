import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planStarter, STARTERS } from './site-starters.mjs';
const json=JSON.stringify;
function fixture(extra={}) {
 const texts={'data/site.json':json({defaultLocale:'en',locales:[{code:'en'},{code:'es'}]}),'data/schema.json':'[]',...extra};
 return {id:'portfolio',locale:'en',paths:Object.keys(texts),texts};
}
for(const starter of STARTERS)for(const look of starter.looks)test(`${starter.id} / ${look.id}: declared templates and collections`,()=>{
 const args={...fixture(),id:starter.id,look:look.id};
 const before=json(args);const plan=planStarter(args);
 assert.equal(json(args),before);
 const schema=JSON.parse(plan.files.find(f=>f.path==='data/schema.json').text);
 assert.deepEqual(schema.find(c=>c.name===starter.contentType.name).fields,starter.templates[starter.contentType.fieldsFrom].fields.fields);
 assert.equal(plan.files.filter(f=>f.path.endsWith('/template.html')).length,3);
 assert.ok(plan.files.find(f=>f.path==='content/pages/en/home.md'));
 assert.equal(plan.files.some(f=>f.path==='data/appearance.json'),false);
});
test('existing homepage and localized navigation survive',()=>{
 const args=fixture({'content/pages/es/home.md':'existing','data/menu.es.json':json({locations:{header:{desktop:[{label:'Existing',url:'/es/'}],tablet:null,mobile:[]}}})});
 const plan=planStarter({...args,locale:'es'});
 assert.equal(plan.overview,'/es/portfolio/');assert.equal(plan.listingUrl,'/es/projects/');
 assert.equal(plan.files.some(f=>f.path==='content/pages/es/home.md'),false);
 const menu=JSON.parse(plan.files.find(f=>f.path==='data/menu.es.json').text);
 assert.equal(menu.locations.header.tablet,null);assert.equal(menu.locations.header.desktop[0].label,'Existing');
 assert.equal(menu.locations.header.mobile[1].url,'/es/projects/');
});
test('sample toggle leaves only overview content',()=>{const plan=planStarter({...fixture(),includeSamples:false});assert.equal(plan.files.filter(f=>f.path.startsWith('content/')).length,1);});
for(const [name,extra] of Object.entries({
 template:{'templates/portfolio-detail/template.html':'owned'},
 collection:{'data/schema.json':json([{name:'projects'}])},
 route:{'data/schema.json':json([{name:'other',route:{base:'projects'}}])},
 page:{'content/pages/en/projects.md':'owned'},
 redirect:{'data/redirects.json':json({redirects:[{from:'/projects/*',to:'/elsewhere',status:301}]})},
 overview:{'content/pages/en/home.md':'home','content/pages/portfolio.md':'legacy'},
 styles:{'data/styles.json':json({variants:[{id:'portfolio-editorial'}]})}
}))test(`collision: ${name} refuses without mutating input`,()=>{const args=fixture(extra);const before=json(args);assert.throws(()=>planStarter(args));assert.equal(json(args),before);});
