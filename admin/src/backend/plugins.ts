export interface PluginManifest { apiVersion: number; id: string; name: string; version: string; description: string; scope: 'site'|'private'; workspace: 'research'|'settings'; operations: string[]; settings: Array<{key:string;label:string;type:'string'|'number'|'boolean';default?:string|number|boolean;required?:boolean}> }
export async function pluginRequest(id?: string, operation?: string, input: Record<string, unknown> = {}): Promise<any> {
  const response = await fetch(`/admin/api/plugins${!operation && id ? `?id=${encodeURIComponent(id)}` : ''}`, {
    credentials: 'same-origin', cache:'no-store', ...(operation ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,operation,input})} : {}),
  });
  const body = await response.json();
  if(!response.ok) throw new Error(body.error || 'The plugin could not complete this action.');
  return body;
}
