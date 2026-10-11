import { GitHubError } from './lanza-content';
import { roleFromPermissions } from './roles';
import { plugins } from './plugin-registry.mjs';
import { pluginId, validatePlugin, validateSettings } from './plugin-contract.mjs';
export const PLUGIN_BODY_LIMIT = 64 * 1024;
export const PLUGIN_STATE_LIMIT = 512 * 1024;
const shaPattern = /^[a-f0-9]{40}$/;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export function catalog() { return plugins.map(p => validatePlugin(p.manifest)); }
function encode(text) { let raw=''; for(const byte of new TextEncoder().encode(text)) raw+=String.fromCharCode(byte); return btoa(raw); }
export class PluginRuntime {
  constructor(client, actor, assertEntry, registry = plugins) { this.client=client; this.actor=actor; this.assertEntry=assertEntry; this.registry=registry; }
  async run(id, operation, input = {}) {
    if (!pluginId(id) || typeof operation !== 'string' || !object(input)) throw new GitHubError(400,'Invalid plugin request.');
    const plugin = this.registry.find(p=>p.manifest.id===id);
    if (!plugin) throw new GitHubError(404,'Plugin is not installed in this deployment.');
    const manifest = validatePlugin(plugin.manifest);
    if (manifest.scope !== 'private') throw new GitHubError(400,'Manage this website feature through its staging settings.');
    if (!['read','set-enabled','settings',...manifest.operations].includes(operation)) throw new GitHubError(400,'Unknown plugin operation.');
    const branch = id === 'research' ? 'lanza-research' : `lanza-plugin-${id}`;
    const path = `plugins/${id}/state.json`;
    const api = (method,path,body) => this.client.pluginArchive(id,method,path,body);
    const guard = async () => {
      if (!/^[A-Za-z0-9-]{1,100}$/.test(this.actor || '')) throw new GitHubError(401,'Sign in again.');
      const repo = await api('GET','');
      if (!repo || repo.private !== true || roleFromPermissions(repo.permissions) !== 'owner') throw new GitHubError(403,'This plugin requires a private repository and owner access.');
      return repo.full_name;
    };
    const repository = await guard();
    const read = async () => {
      const raw = await api('GET',`contents/${path}?ref=${branch}`);
      if (!raw) return {sha:null,state:{version:1,enabled:false,settings:{},data:null}};
      if (!shaPattern.test(raw.sha) || typeof raw.content !== 'string' || raw.content.length > 750000) throw new GitHubError(502,'Invalid saved plugin data.');
      const text = new TextDecoder().decode(Uint8Array.from(atob(raw.content.replace(/\s/g,'')),c=>c.charCodeAt(0)));
      if(new TextEncoder().encode(text).length>PLUGIN_STATE_LIMIT) throw new GitHubError(502,'Plugin data exceeds its limit.');
      let state; try {state=JSON.parse(text);} catch {throw new GitHubError(502,'Invalid saved plugin data.');}
      if (!object(state) || state.version!==1 || typeof state.enabled!=='boolean' || !object(state.settings)) throw new GitHubError(409,'Unsupported plugin data version. Preserve the archive and migrate before continuing.');
      return {sha:raw.sha,state};
    };
    const current = await read();
    if(operation==='read') return {...current,manifest,schedule:{supported:false,enabled:false},storage:{branch}};
    if (input.expectedSha !== current.sha) throw new GitHubError(409,'Plugin data changed. Reload and review before trying again.');
    const save = async state => {
      state = {...state,updatedAt:new Date().toISOString(),updatedBy:this.actor,lastOperation:operation};
      const text=JSON.stringify(state);
      if(new TextEncoder().encode(text).length>PLUGIN_STATE_LIMIT) throw new GitHubError(413,'Research archive is full. Reduce source sizes before refreshing.');
      await guard();
      if(!await api('GET',`git/ref/heads/${branch}`)) {
        const tree=await api('POST','git/trees',{tree:[{path:'README.md',mode:'100644',type:'blob',content:'Private plugin archive. Never merge into website branches.\n'}]});
        const commit=await api('POST','git/commits',{message:'Initialize private plugin archive [skip ci]',tree:tree.sha,parents:[]});
        await guard();
        try {await api('POST','git/refs',{ref:`refs/heads/${branch}`,sha:commit.sha});}
        catch(e) {if(![409,422].includes(e.status) || !await api('GET',`git/ref/heads/${branch}`)) throw e;}
      }
      // Re-read catches disable/configuration changes while an external fetch ran.
      if((await read()).sha!==current.sha) throw new GitHubError(409,'Plugin changed during the operation. Reload before continuing.');
      await guard();
      const result=await api('PUT',`contents/${path}`,{branch,message:`${id}: ${operation} [skip ci]`,content:encode(text),...(current.sha?{sha:current.sha}:{})});
      if(!shaPattern.test(result?.content?.sha)) throw new GitHubError(502,'GitHub did not confirm the saved plugin revision. Reload to check.');
      return {sha:result.content.sha,state};
    };
    if(operation==='set-enabled') {
      if(typeof input.enabled!=='boolean') throw new GitHubError(400,'Choose enabled or disabled.');
      return save({...current.state,enabled:input.enabled});
    }
    if(operation==='settings') {
      let settings;try {settings=validateSettings(manifest,input.settings);}catch(e){throw new GitHubError(400,e.message);}
      return save({...current.state,settings});
    }
    if(operation!=='configure' && !current.state.enabled) throw new GitHubError(409,'Enable this plugin before running it.');
    if(typeof plugin.run!=='function') throw new GitHubError(501,'Plugin operation is not implemented.');
    const result=await plugin.run({operation,input,state:structuredClone(current.state),repository,assertEntry:this.assertEntry,readEntry:path=>this.client.read(path)});
    if (!object(result)) throw new GitHubError(502,'Invalid plugin result.');
    if (result.state) return {...await save(result.state),result:result.result};
    // Read-only proposals must also refuse concurrent disable/configuration changes.
    await guard(); if((await read()).sha!==current.sha) throw new GitHubError(409,'Plugin data changed. Reload before reviewing this proposal.');
    return result.result;
  }
}
