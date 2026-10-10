import { ContentClient, GitHubError } from "./lanza-content";
import { roleFromPermissions } from "./roles";

export const REQUEST_BRANCH = "lanza-agent-requests";
export const REQUEST_BODY_LIMIT = 64 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{40}$/;
type Json = Record<string, unknown>;
export interface AgentRequestAnchor { quote: string; from: number; to: number; bodyHash: string; before: string; after: string }
export interface AgentRequestTask {
  version: 1; id: string; entryPath: string; action: "ask" | "verify" | "source" | "rewrite" | "visual";
  instruction: string; anchor: AgentRequestAnchor; createdAt: string; createdBy: string; updatedAt: string;
  status: "open" | "answered" | "resolved";
  response?: { message: string; replacementHtml?: string; createdAt: string; createdBy: string; origin: "assistant" };
}
export interface RequestEnvelope { task: AgentRequestTask; sha: string }
function object(value: unknown): Json { if (!value || typeof value !== "object" || Array.isArray(value)) throw new GitHubError(400, "Expected an object."); return value as Json; }
function string(value: unknown, label: string, max: number, empty = false): string {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim())) throw new GitHubError(400, `Invalid ${label}.`);
  return value;
}
function requestId(value: unknown): string { const id = string(value, "request ID", 36); if (!UUID.test(id)) throw new GitHubError(400, "Invalid request ID."); return id; }
function encode(text: string): string { let binary = ""; for (const b of new TextEncoder().encode(text)) binary += String.fromCharCode(b); return btoa(binary); }
function decode(text: string): string { return new TextDecoder().decode(Uint8Array.from(atob(text.replace(/\s/g, "")), c => c.charCodeAt(0))); }
function anchor(value: unknown): AgentRequestAnchor {
  const a = object(value);
  if (!Number.isSafeInteger(a.from) || !Number.isSafeInteger(a.to) || Number(a.from) < 0 || Number(a.to) <= Number(a.from) || Number(a.to) > 2_000_000) throw new GitHubError(400, "Invalid selection positions.");
  if (typeof a.bodyHash !== "string" || !/^[a-f0-9]{64}$/.test(a.bodyHash)) throw new GitHubError(400, "Invalid editor body hash.");
  return { quote: string(a.quote, "selected quote", 8000), from: Number(a.from), to: Number(a.to), bodyHash: a.bodyHash, before: string(a.before, "preceding context", 1000, true), after: string(a.after, "following context", 1000, true) };
}
function action(value: unknown): AgentRequestTask["action"] {
  if(value !== "ask" && value !== "verify" && value !== "source" && value !== "rewrite" && value !== "visual") throw new GitHubError(400,"Invalid request action.");
  return value;
}
function actor(value: unknown): string { const login = string(value,"GitHub actor",100); if(!/^[A-Za-z0-9-]+$/.test(login)) throw new GitHubError(502,"Invalid saved actor."); return login; }
function timestamp(value: unknown): string { const time = string(value,"timestamp",32); if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(time) || !Number.isFinite(Date.parse(time))) throw new GitHubError(502,"Invalid saved timestamp."); return time; }
export class AgentRequests {
  private client: ContentClient;
  private assertEntry: (path: string) => Promise<string>;
  private actor: string;
  constructor(client: ContentClient, assertEntry: (path: string) => Promise<string>, actor: string) { this.client = client; this.assertEntry = assertEntry; this.actor = actor; }
  private api(method: string, path: string, body?: unknown): Promise<unknown> { return this.client.agentRequestArchive(method,path,body); }
  private async guard(): Promise<void> {
    if (!/^[A-Za-z0-9-]{1,100}$/.test(this.actor)) throw new GitHubError(401, "Authenticated GitHub identity required.");
    const metadata = await this.api("GET", "");
    if (!metadata || object(metadata).private !== true) throw new GitHubError(403, "Private repository required for agent requests. Published pages can remain public.");
    if (roleFromPermissions(object(metadata).permissions) !== "owner") throw new GitHubError(403, "Agent requests are available to the site owner only.");
  }
  private async ensureBranch(): Promise<void> {
    if (await this.api("GET", `git/ref/heads/${REQUEST_BRANCH}`)) return;
    const tree = object(await this.api("POST", "git/trees", { tree: [{ path: "README.md", mode: "100644", type: "blob", content: "Private agent requests. Never merge this archive into website branches.\n" }] }));
    const commit = object(await this.api("POST", "git/commits", { message: "Initialize private agent request archive [skip ci]", tree: tree.sha, parents: [] }));
    await this.guard();
    try { await this.api("POST", "git/refs", { ref: `refs/heads/${REQUEST_BRANCH}`, sha: commit.sha }); }
    catch (error) {
      // Another owner request may have created the branch in the meantime.
      // Only an actual, readable branch turns a create conflict into success.
      if (!(error instanceof GitHubError) || ![409,422].includes(error.status) || !await this.api("GET", `git/ref/heads/${REQUEST_BRANCH}`)) throw error;
    }
  }
  private async readStored(id: string): Promise<RequestEnvelope> {
    const raw = await this.api("GET", `contents/requests/${requestId(id)}.json?ref=${REQUEST_BRANCH}`);
    if (!raw) throw new GitHubError(404, "Agent request not found.");
    const file = object(raw);
    if (typeof file.content !== "string" || file.content.length > 100000 || !SHA.test(String(file.sha))) throw new GitHubError(502, "Invalid agent request file.");
    const text = decode(file.content);
    if (new TextEncoder().encode(text).byteLength > REQUEST_BODY_LIMIT) throw new GitHubError(502, "Agent request exceeds its limit.");
    const record = object(JSON.parse(text));
    if (record.version !== 1 || record.id !== id || typeof record.entryPath !== "string" || (record.status !== "open" && record.status !== "answered" && record.status !== "resolved")) throw new GitHubError(502, "Invalid saved agent request.");
    await this.assertEntry(record.entryPath);
    // Validate archived records too: a collaborator can edit the private branch.
    const task: AgentRequestTask = { version:1,id,entryPath:record.entryPath,action:action(record.action),anchor:anchor(record.anchor),instruction:string(record.instruction,"instruction",4000,true),createdAt:timestamp(record.createdAt),createdBy:actor(record.createdBy),updatedAt:timestamp(record.updatedAt),status:record.status };
    if(record.response !== undefined) {
      const response = object(record.response);
      if(response.origin !== "assistant") throw new GitHubError(502,"Invalid saved response origin.");
      task.response = {message:string(response.message,"response message",8000),...(response.replacementHtml === undefined?{}:{replacementHtml:string(response.replacementHtml,"replacement HTML",24000,true)}),createdAt:timestamp(response.createdAt),createdBy:actor(response.createdBy),origin:"assistant"};
    }
    if(task.status === "answered" && !task.response) throw new GitHubError(502,"Answered request is missing its response.");
    return { task, sha: String(file.sha) };
  }
  async read(id: string): Promise<RequestEnvelope> { requestId(id); await this.guard(); return this.readStored(id); }
  async list(entryPath?: string, cursor?: string): Promise<{ requests: RequestEnvelope[]; truncated: boolean; nextCursor: string | null }> {
    if (cursor) requestId(cursor);
    await this.guard(); if (entryPath) await this.assertEntry(entryPath);
    const raw = await this.api("GET", `contents/requests?ref=${REQUEST_BRANCH}`);
    if (!raw) return { requests: [], truncated: false, nextCursor: null };
    if (!Array.isArray(raw)) throw new GitHubError(502, "Invalid agent request listing.");
    // Contents directory listings cap at 1,000. Never imply a complete inbox if
    // the API may have silently truncated it; partitioning is a later migration.
    if (raw.length >= 1000) throw new GitHubError(413, "Request archive needs partitioning before it can be listed safely.");
    const ids = raw.filter(item => item?.type === "file" && typeof item.name === "string" && item.name.endsWith(".json") && UUID.test(item.name.slice(0,-5)))
      .map(item => item.name.slice(0,-5) as string).sort().reverse().filter(id => !cursor || id < cursor);
    const page = ids.slice(0,20); const requests: RequestEnvelope[] = [];
    for (const id of page) { const envelope = await this.readStored(id); if (!entryPath || envelope.task.entryPath === entryPath) requests.push(envelope); }
    return { requests, truncated: ids.length > page.length, nextCursor: ids.length > page.length ? page.at(-1) || null : null };
  }
  async create(input: unknown): Promise<RequestEnvelope> {
    const data = object(input); const selection = anchor(data.anchor);
    const id = requestId(data.id);
    const instruction = string(data.instruction,"instruction",4000,true); const entryPath = string(data.entryPath,"entry path",500);
    const requestedAction = action(data.action);
    await this.guard(); await this.assertEntry(entryPath);
    const sameCapture = (stored: RequestEnvelope): RequestEnvelope => {
      if (stored.task.createdBy !== this.actor || stored.task.entryPath !== entryPath || stored.task.action !== data.action || stored.task.instruction !== instruction || JSON.stringify(stored.task.anchor) !== JSON.stringify(selection)) throw new GitHubError(409,"This request ID already belongs to a different capture.");
      return stored;
    };
    try { return sameCapture(await this.readStored(id)); } catch (error) { if (!(error instanceof GitHubError) || error.status !== 404) throw error; }
    await this.ensureBranch();
    const now = new Date().toISOString();
    const task: AgentRequestTask = { version:1,id,entryPath,action:requestedAction,instruction,anchor:selection,createdAt:now,createdBy:this.actor,updatedAt:now,status:"open" };
    try { return await this.write(task); } catch (error) {
      if (!(error instanceof GitHubError) || ![409,422].includes(error.status)) throw error;
      return sameCapture(await this.readStored(id));
    }
  }
  async update(input: unknown): Promise<RequestEnvelope> {
    const data = object(input); const id = requestId(data.id);
    if (typeof data.expectedSha !== "string" || !SHA.test(data.expectedSha)) throw new GitHubError(400,"Expected the SHA returned when reading this request.");
    if ((data.response === undefined) === (data.status !== "resolved")) throw new GitHubError(400,"Pass either a response or status resolved.");
    await this.guard(); const existing = await this.readStored(id);
    if (existing.sha !== data.expectedSha) throw new GitHubError(409,"This request changed. Reload before responding or resolving.");
    if (existing.task.status === "resolved") throw new GitHubError(409,"This request has already been resolved.");
    const task = { ...existing.task, updatedAt:new Date().toISOString() };
    if (data.response !== undefined) {
      const response = object(data.response);
      task.response = { message:string(response.message,"response message",8000), ...(response.replacementHtml === undefined ? {} : { replacementHtml:string(response.replacementHtml,"replacement HTML",24000,true) }), createdAt:task.updatedAt,createdBy:this.actor,origin:"assistant" };
      task.status = "answered";
    } else task.status = "resolved";
    return this.write(task,existing.sha);
  }
  private async write(task: AgentRequestTask, sha?: string): Promise<RequestEnvelope> {
    const text = JSON.stringify(task,null,2) + "\n";
    if (new TextEncoder().encode(text).byteLength > REQUEST_BODY_LIMIT) throw new GitHubError(413,"Agent request exceeds its limit.");
    await this.guard();
    const saved = object(await this.api("PUT",`contents/requests/${task.id}.json`,{ branch:REQUEST_BRANCH,message:`Agent request ${task.id}: ${task.status} [skip ci]`,content:encode(text),...(sha ? {sha} : {}) }));
    const resultSha = object(saved.content).sha;
    if (typeof resultSha !== "string" || !SHA.test(resultSha)) throw new GitHubError(502,"GitHub did not confirm the saved request SHA.");
    return {task,sha:resultSha};
  }
}
