import { ref, watch, type Ref } from "vue";
import { isOwner } from "./access";
export interface PluginManifest { apiVersion: number; id: string; name: string; version: string; description: string; scope: 'site'|'private'; workspace: 'research'|'settings'; operations: string[]; settings: Array<{key:string;label:string;type:'string'|'number'|'boolean';default?:string|number|boolean;required?:boolean}> }
// Agent highlights, notices and requests are the opt-in Agent requests plugin.
// Unreadable state (public repo, non-owner, network) keeps the feature off.
export async function agentRequestsEnabled(): Promise<boolean> {
  try { return (await pluginRequest("agent-requests")).state?.enabled === true; } catch { return false; }
}
// Owner-only, and re-evaluated on role changes. A late answer from an earlier role
// is discarded, so a fetch started as owner cannot turn the feature on for an editor.
export function useAgentRequestsEnabled(): Ref<boolean> {
  const enabled = ref(false);
  watch(isOwner, async (owner, _previous, onCleanup) => {
    let current = true;
    onCleanup(() => { current = false; });
    enabled.value = false;
    if (!owner) return;
    const on = await agentRequestsEnabled();
    if (current) enabled.value = on;
  }, { immediate: true });
  return enabled;
}
export async function pluginRequest(id?: string, operation?: string, input: Record<string, unknown> = {}): Promise<any> {
  const response = await fetch(`/admin/api/plugins${!operation && id ? `?id=${encodeURIComponent(id)}` : ''}`, {
    credentials: 'same-origin', cache:'no-store', ...(operation ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,operation,input})} : {}),
  });
  const body = await response.json();
  if(!response.ok) throw new Error(body.error || 'The plugin could not complete this action.');
  return body;
}
