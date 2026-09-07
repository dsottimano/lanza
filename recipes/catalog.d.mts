export interface StarterLook { id: string; label: string; description: string; brand: { colors: Record<string,string>; [key:string]: unknown } }
export interface Starter { id:string; label:string; description:string; version:string; features:string[]; notIncluded:string[]; looks:StarterLook[]; home:{stem:string;preset:string;title:string;slots:Record<string,unknown>}; templates:Record<string,{html:string;position:string;fields:Record<string,unknown>}>; contentType:{name:string;route:{base:string}} }
export const STARTERS: Starter[];
export function starterSummary(starter:Starter): Record<string,unknown>;
