import { afterEach, beforeEach, expect, it } from 'vitest';
import { COLLECTIONS, setCollections, type FolderCollection } from '../schema';
import { entryPath, entryPathFrame, entryUrl, stagingOrigin } from './site-urls';
import { site } from './site';
const original=JSON.parse(JSON.stringify(COLLECTIONS));
const savedSite={defaultLocale:site.defaultLocale,locales:site.locales,urls:site.urls};
const routed=(localized:boolean):FolderCollection=>({kind:'folder',name:'events',label:'Events',labelSingular:'Event',folder:'content/events',body:'none',fields:[],localized,route:{base:'calendar',template:'event'}});
beforeEach(()=>{site.defaultLocale='en';site.locales=[{code:'en',label:'English'},{code:'es',label:'Español'}];site.urls={};stagingOrigin.value='https://staging.fixture.pages.dev';});
afterEach(()=>{setCollections(original);Object.assign(site,savedSite);stagingOrigin.value=null;});
it('uses the declared base and localization for generated custom detail routes',()=>{
 setCollections([...original,routed(true)]);
 expect(entryPath('events','meetup','en')).toBe('/calendar/meetup/');
 expect(entryPath('events','meetup','es')).toBe('/es/calendar/meetup/');
 expect(entryPathFrame('events','meetup','es')).toEqual({prefix:'/es/calendar/',suffix:'/'});
 expect(entryUrl('events','meetup','es')).toBe('https://staging.fixture.pages.dev/es/calendar/meetup/');
});
it('shared custom routes stay at the root and use entry IDs, matching detailRoot',()=>{
 setCollections([...original,routed(false)]);site.urls={'events/es/meetup':'ignored'};
 expect(entryPath('events','meetup','es')).toBe('/calendar/meetup/');
 expect(entryPath('events','home','es')).toBe('/calendar/home/');
});
it('localized mappings follow splitEntries and the selected default locale',()=>{
 setCollections([...original,routed(true)]);site.defaultLocale='es';site.urls={'events/es/meetup':'encuentro'};
 expect(entryPath('events','meetup','es')).toBe('/calendar/encuentro/');
 expect(entryPath('events','meetup','en')).toBe('/en/calendar/meetup/');
 expect(entryPath('events','meetup','fr')).toBeNull();
});
it('schema changes immediately update links; missing and malformed routes have none',()=>{
 setCollections([...original,routed(true)]);
 const entry=COLLECTIONS.find(c=>c.name==='events') as FolderCollection;
 entry.route!.base='gatherings';expect(entryPath('events','meetup','en')).toBe('/gatherings/meetup/');
 entry.route!.base='../invalid';expect(entryUrl('events','meetup','en')).toBeNull();
 delete entry.route;expect(entryPath('events','meetup','en')).toBeNull();
});
