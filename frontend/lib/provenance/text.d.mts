export const ORIGIN_ATTRIBUTE: string;
export function escapeText(value: unknown): string;
export function agentFlags(before:string, after:string, previousFlags?:boolean[], additionsAreAgent?:boolean):boolean[];
export function segments(text:string, flags:boolean[]):{text:string;agent:boolean}[];
export function markedText(text:string, flags:boolean[]):string;
export function fieldRecords(data:any):Record<string,{origin:'agent';text:string}>;
export function recordAgentFields(before:any, after:any):{version:1;fields:Record<string,{origin:'agent';text:string}>};
export function fieldAgentHtml(data:any, path:string, value:unknown):string;
export function scopedProvenance(data:any, prefix:string):{version:1;fields:Record<string,{origin:'agent';text:string}>};
