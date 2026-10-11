import { readdir, readFile, writeFile, mkdir, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePlugin } from '../functions/_lib/plugin-contract.mjs';
const packageRoot = fileURLToPath(new URL('..',import.meta.url));
export async function buildPlugins(tenantRoot, outputRoot = tenantRoot) {
  const records = [];
  const seen = new Set();
  for (const [root,builtin] of [[packageRoot,true], ...(path.resolve(tenantRoot) === path.resolve(packageRoot) ? [] : [[tenantRoot,false]])]) {
    const dir = path.join(root,'plugins');
    let names; try { names = await readdir(dir); } catch(e) { if(e.code === 'ENOENT') continue; throw e; }
    for (const name of names.sort()) {
      if (!(await lstat(path.join(dir,name))).isDirectory()) throw new Error('Plugin directories must not be symlinks.');
      const file = path.join(dir,name,'plugin.json');
      if (!(await lstat(file)).isFile() || await realpath(file) !== file) throw new Error('Plugin manifest must be a regular file.');
      const m = validatePlugin(JSON.parse(await readFile(file,'utf8')));
      if (m.id !== name || seen.has(m.id)) throw new Error(`Duplicate or mismatched plugin: ${m.id}`);
      seen.add(m.id);
      if (!builtin && m.scope !== 'private') throw new Error('Custom v1 plugins use the private request runtime.');
      let handler = null;
      if (m.scope === 'private') {
        if (builtin && m.id === 'research') handler = './research-plugin.mjs';
        else {
          const entry = path.join(dir,name,'server.mjs');
          if (!(await lstat(entry)).isFile() || await realpath(entry) !== entry) throw new Error('Plugin server must be a regular file.');
          handler = '../../plugins/'+name+'/server.mjs';
        }
      }
      records.push({manifest:m,handler});
    }
  }
  const output = path.join(outputRoot,'functions/_lib/plugin-registry.mjs');
  let code = '// Generated plugin registry. Reviewed repository code only.\n';
  records.forEach((r,i)=> { if(r.handler) code += `import run${i} from ${JSON.stringify(r.handler)};\n`; });
  code += 'export const plugins = [\n'+records.map((r,i)=>`{manifest:${JSON.stringify(r.manifest)}${r.handler?`,run:run${i}`:''}}`).join(',\n')+'\n];\n';
  await mkdir(path.dirname(output),{recursive:true});
  await writeFile(output,code);
  return records.map(r=>r.manifest);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildPlugins(process.cwd());
