export { STARTERS, starterSummary } from '../../recipes/catalog.mjs';
export function starterReadPaths(id:string, locale:string):string[];
export interface StarterPlan { id:string;label:string;locale:string;look:string;overview:string;listingUrl:string;homePreserved:boolean;files:{path:string;text:string;action:string}[];notes:string[];notIncluded:string[] }
export function planStarter(options:{id:string;locale:string;look?:string;includeSamples?:boolean;paths:string[];texts:Record<string,string>}):StarterPlan;
