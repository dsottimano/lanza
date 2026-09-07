import { STARTERS, starterSummary } from "../../recipes/catalog.mjs";
import { checkTemplate, checkTemplateSafety } from "./site-system.mjs";
import { resolveBrand } from "../../frontend/lib/appearance.ts";

export { STARTERS, starterSummary };
const json = value => JSON.stringify(value, null, 2) + "\n";
const clone = value => JSON.parse(JSON.stringify(value));
const segment = /^[a-z][a-z0-9-]*$/;
const safePath = path => typeof path === "string" && !path.includes("\\") && !path.includes("%") && !path.includes("\0") && path.split("/").every(part => part && part !== "." && part !== "..");
export function getStarter(id) {
  const starter = STARTERS.find(item => item.id === id);
  if (!starter) throw new Error("Unknown site starter.");
  return starter;
}
export function starterReadPaths(id, locale) {
  if (!segment.test(locale)) throw new Error("Invalid language code.");
  getStarter(id);
  return ["data/site.json", "data/schema.json", "data/styles.json", "data/starters.json", "data/redirects.json", `data/menu.${locale}.json`];
}

// A pure plan over a pinned repository snapshot. No I/O and no partial mutations.
// `paths` is a complete tree listing; `texts` contains the files from starterReadPaths.
export function planStarter({ id, locale, look = "editorial", includeSamples = true, paths, texts }) {
  const starter = getStarter(id);
  if (!segment.test(locale)) throw new Error("Invalid language code.");
  const selected = starter.looks.find(item => item.id === look);
  if (!selected) throw new Error("Unknown visual style.");
  const read = (path, fallback) => texts[path] === undefined ? clone(fallback) : JSON.parse(texts[path]);
  const site = read("data/site.json", null);
  if (!site || !Array.isArray(site.locales) || !site.locales.some(item => item.code === locale)) throw new Error("Choose an enabled site language.");
  const schema = read("data/schema.json", []);
  if (!Array.isArray(schema)) throw new Error("The content model could not be read.");
  const allPaths = new Set(paths);
  if (schema.some(item => item.name === starter.contentType.name)) throw new Error(`The ${starter.contentType.name} collection already exists. This starter will not replace it.`);
  if (schema.some(item => item.route?.base === starter.contentType.route.base)) throw new Error("Another content type already uses this starter's route.");
  if (site.locales.some(item => item.code === starter.contentType.route.base)) throw new Error("This starter's route conflicts with an enabled language.");
  const files = [];
  const add = (path, text, mode = "create") => {
    if (!safePath(path)) throw new Error("Refusing an unsafe starter path.");
    if (mode === "create" && allPaths.has(path)) throw new Error(`Already exists: ${path}. Existing content and templates are never overwritten.`);
    if (mode === "update" && allPaths.has(path) && texts[path] === undefined) throw new Error(`Could not read ${path}; no changes can be prepared.`);
    files.push({path,text,action:allPaths.has(path)?"update":"create"});
  };
  const existingPages = schema.find(item => item.name === "pages");
  if (existingPages && (existingPages.folder !== "content/pages" || existingPages.localized !== true)) throw new Error("This starter needs the standard localized Pages collection at content/pages.");
  const homeExists = allPaths.has(`content/pages/${locale}/home.md`) || (locale === site.defaultLocale && allPaths.has("content/pages/home.md"));
  const stem = homeExists ? starter.home.stem : "home";
  const prefix = locale === site.defaultLocale ? "" : `/${locale}`;
  const overview = `${prefix}/${stem === "home" ? "" : stem + "/"}`;
  const listingUrl = `${prefix}/${starter.contentType.route.base}/`;
  if (schema.some(item => item.route?.base === stem)) throw new Error("A collection already claims the overview URL.");
  if (locale === site.defaultLocale && allPaths.has(`content/pages/${stem}.md`)) throw new Error("A legacy page already exists at the overview URL.");
  const pageSlug = stem === "home" ? "" : stem;
  const urlMap = site.urls ?? {};
  if (Object.entries(urlMap).some(([key,value]) => key.startsWith(`pages/${locale}/`) && value === pageSlug)) throw new Error("A page already claims the starter overview URL.");
  if (urlMap[`pages/${locale}/${stem}`] !== undefined) throw new Error("A saved URL mapping exists for this page. Resolve it before installing the starter.");
  if (allPaths.has(`content/pages/${locale}/${starter.contentType.route.base}.md`) || (locale === site.defaultLocale && allPaths.has(`content/pages/${starter.contentType.route.base}.md`)) || Object.entries(urlMap).some(([key,value]) => key.startsWith(`pages/${locale}/`) && value === starter.contentType.route.base)) throw new Error("A page already claims the starter listing URL.");
  const redirects = read("data/redirects.json", {redirects:[]});
  if (!Array.isArray(redirects.redirects)) throw new Error("Redirect settings could not be read.");
  const targets=[overview,listingUrl,...(includeSamples?starter.samples.map(sample=>`${listingUrl}${sample.stem}/`):[])];
  for (const rule of redirects.redirects) {
    if (typeof rule.from !== "string") throw new Error("A redirect is malformed. Review it before installing.");
    const pattern=rule.from.split(/([*]|:[a-zA-Z_][\w]*)/).map(part=>part==='*'?'.*':part.startsWith(':')?'[^/]+':part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('');
    if(targets.some(target=>new RegExp(`^${pattern}/?$`).test(target) || new RegExp(`^${pattern}/?$`).test(target.replace(/\/$/,'')))) throw new Error(`A redirect covers ${rule.from}. Resolve it before installing this starter.`);
  }
  const resolved=resolveBrand({brand:selected.brand});
  const themeStyle=`<style>${resolved.fontHref ? `@import url("${resolved.fontHref}");` : ""}.starter--${id}{${resolved.styleVars}}</style>`;
  const world={collections:new Map([[starter.contentType.name,new Set(starter.templates[starter.contentType.fieldsFrom].fields.fields.map(field=>field.name))]])};
  for(const [name,template] of Object.entries(starter.templates)) {
    const html=themeStyle+template.html.replaceAll('class="starter"',`class="starter starter--${id}"`);
    const problems=[...checkTemplate({name,html,fields:template.fields,position:template.position},world),...checkTemplateSafety(html)];
    const errors=problems.filter(problem=>problem.level==='error');
    if(errors.length) throw new Error(`Invalid starter template ${name}: ${errors.map(error=>error.message).join('; ')}`);
    add(`templates/${name}/template.html`,html);
    add(`templates/${name}/fields.json`,json(template.fields));
  }
  const fields = [
    {name:"title",label:"Title",widget:"string"}, {name:"draft",label:"Draft",widget:"boolean",default:true},
    {name:"template",label:"Layout",widget:"select",options:["default","full-width","landing"],required:false},
    {name:"preset",label:"Content template",widget:"preset",required:false}, {name:"slots",label:"Content",widget:"slots",required:false},
  ];
  if (!existingPages) schema.push({kind:"folder",name:"pages",label:"Pages",labelSingular:"Page",folder:"content/pages",localized:true,body:"rich",fields});
  else existingPages.fields=[...(existingPages.fields??[]),...fields.filter(field=>!(existingPages.fields??[]).some(existing=>existing.name===field.name))];
  const collection=clone(starter.contentType);
  collection.kind="folder";collection.fields=clone(starter.templates[collection.fieldsFrom].fields.fields);delete collection.fieldsFrom;
  schema.push(collection);
  add("data/schema.json",json(schema),"update");
  // JSON is a YAML subset. This preserves nested values without a second serializer.
  const document=(data,body="")=>`---\n${json(data)}---\n\n${body}\n`;
  const slots={...clone(starter.home.slots),browseUrl:listingUrl};
  add(`content/pages/${locale}/${stem}.md`,document({title:starter.home.title,draft:false,template:"landing",preset:starter.home.preset,slots}));
  if(includeSamples) for(const sample of starter.samples) add(`content/${collection.name}/${locale}/${sample.stem}.md`,document({...sample.data,draft:false,contactLabel:"Get in touch",contactUrl:"",demoNote:"Example content. Replace with your own before publishing."},sample.body));
  const styleData=read("data/styles.json",{variants:[]});
  if(!Array.isArray(styleData.variants)) throw new Error("Existing style options could not be read.");
  for(const variant of starter.looks) {
    const variantId=`${id}-${variant.id}`;
    if(styleData.variants.some(existing=>existing.id===variantId)) throw new Error("Starter style options already exist. Nothing will be overwritten.");
    styleData.variants.push({...variant,id:variantId,note:variant.description});
  }
  add("data/styles.json",json(styleData),"update");
  const menuPath=`data/menu.${locale}.json`;
  const menu=read(menuPath,{locations:{header:{desktop:[],tablet:null,mobile:null},footer:{desktop:[],tablet:null,mobile:null}}});
  const newLinks=[{label:starter.label,url:overview},{label:collection.label,url:listingUrl}];
  if(menu.locations) {
    menu.locations.header??={desktop:[],tablet:null,mobile:null};
    const device=menu.locations.header;
    for(const key of ["desktop","tablet","mobile"]) {
      if(key!=="desktop" && device[key]===null)continue;
      if(key!=="desktop" && device[key]===undefined)continue;
      if(!Array.isArray(device[key]))throw new Error("Existing navigation could not be read.");
      device[key]=[...device[key],...newLinks.filter(link=>!device[key].some(existing=>existing.url===link.url))];
    }
  } else {
    if(!Array.isArray(menu.header??[]))throw new Error("Existing navigation could not be read.");
    menu.header=[...(menu.header??[]),...newLinks.filter(link=>!(menu.header??[]).some(existing=>existing.url===link.url))];
  }
  add(menuPath,json(menu),"update");
  const installed=read("data/starters.json",{installed:[]});
  if(!Array.isArray(installed.installed))throw new Error("Starter history could not be read.");
  installed.installed.push({id,version:starter.version,locale,look,overview,collection:collection.name,sampleContent:includeSamples});
  add("data/starters.json",json(installed),"update");
  return {id,label:starter.label,locale,look,overview,listingUrl,homePreserved:homeExists,files,notes:["Installation is staged, not published.","Existing content, brand settings and redirects are preserved.","Starter styling is scoped to its own templates.","The introductory page and included examples contain English sample copy. Replace or translate it before publishing.","Contact links are empty until you supply an address or contact page."],notIncluded:starter.notIncluded};
}
