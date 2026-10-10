<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, watchEffect } from "vue";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { captureRequestAnchor, createAgentRequest, listAgentRequests, newRequestId, requestActions, requestContext, requestInstructions, resolveAgentRequest,
  type RequestAction, type RequestAnchor, type SavedRequest } from "../backend/agent-requests";

const props = defineProps<{ editor?: Editor; path: string | null; enabled: boolean; locked: boolean;
  reviewReplacement: (anchor: RequestAnchor, html: string) => Promise<boolean> }>();
const emit = defineEmits<{ busy: [value: boolean] }>();
const open = ref(false);
const selectedText = ref("");
const requests = ref<SavedRequest[]>([]);
const truncated = ref(false);
const nextCursor = ref<string | null>(null);
let loadedOlder = false;
const loading = ref(false);
const working = ref(false);
const capturing = ref(false);
const error = ref("");
const notice = ref("");
const copiedContext = ref("");
const pending = ref<{ id: string; action: RequestAction; anchor: RequestAnchor; submittedInstruction?: string } | null>(null);
const instruction = ref("");
const dialog = ref<HTMLDialogElement>();
const noteInput = ref<HTMLTextAreaElement>();
const requestButton = ref<HTMLButtonElement>();
const count = computed(() => requests.value.filter(saved => saved.task.status !== "resolved").length);
const available = computed(() => props.enabled && !!props.path && !!props.editor);
let generation = 0;
let alive = true;
let controller: AbortController | null = null;
let poll: ReturnType<typeof setInterval> | undefined;
watchEffect(() => emit("busy", !!pending.value || working.value || capturing.value));

function updateSelection() {
  const editor = props.editor;
  if (!editor || editor.isDestroyed) { selectedText.value = ""; return; }
  const selection = editor.state.selection;
  selectedText.value = selection instanceof TextSelection && !selection.empty
    ? editor.state.doc.textBetween(selection.from, selection.to, "\n") : "";
}
watch(() => props.editor, (editor, previous) => {
  previous?.off("selectionUpdate", updateSelection); previous?.off("update", updateSelection);
  editor?.on("selectionUpdate", updateSelection); editor?.on("update", updateSelection); updateSelection();
}, { immediate: true });

async function refresh(older = false, automatic = false) {
  if (!available.value || loading.value || working.value) return;
  const epoch = generation;
  controller = new AbortController(); loading.value = true;
  try {
    const result = await listAgentRequests(props.path!, controller.signal, older ? nextCursor.value ?? undefined : undefined);
    if (!alive || epoch !== generation) return;
    if (!Array.isArray(result.requests) || typeof result.truncated !== "boolean") throw new Error("The saved request list is unavailable.");
    requests.value = older ? [...requests.value, ...result.requests.filter(saved => !requests.value.some(item => item.task.id === saved.task.id))]
      : automatic ? [...result.requests, ...requests.value.filter(saved => !result.requests.some(item => item.task.id === saved.task.id))] : result.requests;
    if (!automatic || !loadedOlder) { truncated.value = result.truncated; nextCursor.value = result.nextCursor ?? null; }
    if (older) loadedOlder = true; else if (!automatic) loadedOlder = false;
    error.value = "";
  } catch (reason) {
    if (alive && epoch === generation && !controller?.signal.aborted) error.value = reason instanceof Error ? reason.message : "Could not load requests.";
  } finally { if (epoch === generation) { loading.value = false; controller = null; } }
}
function updatePolling() {
  if (poll) clearInterval(poll);
  poll = undefined;
  if (open.value && available.value && document.visibilityState !== "hidden") {
    void refresh(false, true); poll = setInterval(() => void refresh(false, true), 30_000);
  }
}
watch([available, () => props.path], () => {
  generation++; controller?.abort(); controller = null; loading.value = false;
  working.value = false; capturing.value = false;
  loadedOlder = false;
  requests.value = []; truncated.value = false; nextCursor.value = null; error.value = ""; notice.value = ""; copiedContext.value = "";
  cancelRequest();
  if (available.value) void refresh(); updatePolling();
}, { immediate: true });
watch(open, updatePolling);
onMounted(() => document.addEventListener("visibilitychange", updatePolling));
onBeforeUnmount(() => {
  alive = false; generation++; controller?.abort(); if (poll) clearInterval(poll);
  props.editor?.off("selectionUpdate", updateSelection); props.editor?.off("update", updateSelection);
  document.removeEventListener("visibilitychange", updatePolling); dialog.value?.close(); emit("busy", false);
});

async function beginRequest(action: RequestAction) {
  if (!available.value || props.locked || working.value || capturing.value || pending.value) return;
  const epoch = generation; capturing.value = true; error.value = "";
  try {
    const anchor = await captureRequestAnchor(props.editor!);
    if (!alive || epoch !== generation || props.locked) return;
    pending.value = { id: newRequestId(), action, anchor }; instruction.value = "";
    await nextTick(); dialog.value?.showModal(); noteInput.value?.focus();
  } catch (reason) { if (alive && epoch === generation) { error.value = String(reason instanceof Error ? reason.message : reason); open.value = true; } }
  finally { if (epoch === generation) capturing.value = false; }
}
function cancelRequest() {
  dialog.value?.close(); pending.value = null;
}
async function submitRequest() {
  if (!pending.value || working.value || props.locked || !available.value) return;
  const epoch = generation; const snapshot = pending.value; const path = props.path!;
  working.value = true; error.value = "";
  try {
    // Retain both ID and payload if a response is lost; retry cannot duplicate the request.
    snapshot.submittedInstruction ??= instruction.value.trim() || requestInstructions[snapshot.action];
    const saved = await createAgentRequest(snapshot.id, path, snapshot.action, snapshot.submittedInstruction, snapshot.anchor);
    if (!alive || epoch !== generation) return;
    requests.value = [saved, ...requests.value.filter(item => item.task.id !== saved.task.id)];
    cancelRequest(); open.value = true; notice.value = "Ready for your connected agent. Saving a request does not start this chat.";
  } catch (reason) { if (alive && epoch === generation) error.value = reason instanceof Error ? reason.message : "Could not save request."; }
  finally { if (alive && epoch === generation) working.value = false; }
}
async function resolve(saved: SavedRequest, apply = false) {
  if (working.value || props.locked || !available.value) return;
  const epoch = generation; working.value = true; error.value = ""; notice.value = "";
  let applied = false;
  try {
    if (apply) {
      if (!saved.task.response?.replacementHtml) return;
      applied = await props.reviewReplacement(saved.task.anchor, saved.task.response.replacementHtml);
      if (!applied || !alive || epoch !== generation) return;
      notice.value = "Applied in your editor. Save to keep the draft; publication is separate.";
    }
    const resolved = await resolveAgentRequest(saved);
    if (!alive || epoch !== generation) return;
    requests.value = requests.value.map(item => item.task.id === resolved.task.id ? resolved : item);
    if (!apply) notice.value = "Request resolved. Your article was not changed.";
  } catch (reason) {
    if (alive && epoch === generation) error.value = `${applied ? "The edit was accepted, but the request could not be marked resolved. Refresh and resolve it manually. " : ""}${reason instanceof Error ? reason.message : "Could not update request."}`;
  } finally { if (alive && epoch === generation) working.value = false; }
}
async function copy(saved: SavedRequest) {
  copiedContext.value = requestContext(saved.task);
  try { await navigator.clipboard.writeText(copiedContext.value); notice.value = "Request context copied. Paste it into your agent conversation."; }
  catch { notice.value = "Select and copy the request context below."; }
}
</script>

<template>
  <div v-if="enabled" class="agent-requests">
    <div class="request-heading">
      <button ref="requestButton" class="btn btn-ghost" type="button" :aria-expanded="open" aria-controls="agent-request-panel" @click="open = !open">Requests<span v-if="count"> ({{ count }}{{ truncated ? '+' : '' }})</span></button>
      <span v-if="!path" class="request-hint">Save your draft to attach a request.</span>
      <span v-else class="request-hint">Select text to ask your agent.</span>
    </div>
    <div v-if="available && selectedText.trim() && !pending" class="selection-requests" role="toolbar" aria-label="Ask your agent about selected text">
      <span class="sr-only">Selected: {{ selectedText.slice(0, 160) }}</span>
      <button v-for="(label, action) in requestActions" :key="action" type="button" class="btn btn-ghost" :disabled="locked || working || capturing"
        @pointerdown.prevent @click="beginRequest(action)">{{ label }}</button>
    </div>

    <dialog v-if="pending" ref="dialog" class="request-dialog" aria-labelledby="request-dialog-title" @cancel.prevent="!working && cancelRequest()">
      <h2 id="request-dialog-title">{{ requestActions[pending.action] }}</h2>
      <blockquote>{{ pending.anchor.quote }}</blockquote>
      <label for="agent-request-instruction">Anything to add? <span class="request-hint">Optional</span></label>
      <textarea id="agent-request-instruction" ref="noteInput" v-model="instruction" maxlength="4000" rows="4" placeholder="For example: verify against primary sources, or suggest an animated explanation of how the ground moves." :disabled="working || pending.submittedInstruction !== undefined" />
      <p class="request-hint">Saved privately beside this draft for your connected agent. Submitting does not start an AI conversation or change your article.</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <div class="request-actions"><button class="btn btn-ghost" :disabled="working" @click="cancelRequest">Cancel</button><button class="btn btn-primary" :disabled="working || locked" @click="submitRequest">{{ working ? 'Saving…' : 'Save request' }}</button></div>
    </dialog>

    <aside v-if="open" id="agent-request-panel" class="request-panel" aria-label="Saved agent requests">
      <div class="request-heading"><h2>Requests <span v-if="count">({{ count }}{{ truncated ? '+' : '' }})</span></h2>
        <div class="request-actions"><button type="button" class="btn btn-ghost" :disabled="loading || working" @click="refresh()">{{ loading ? 'Refreshing…' : 'Refresh' }}</button><button type="button" class="btn btn-ghost" aria-label="Close requests" @click="open = false; requestButton?.focus()">✕</button></div>
      </div>
      <p class="request-hint">Ready for your connected agent. This panel checks for replies while open. Requests stay outside website publishing.</p>
      <p v-if="notice" role="status">{{ notice }}</p><p v-if="error" role="alert">{{ error }}</p>
      <p v-if="truncated" class="request-hint">More requests are available. The count covers loaded requests.</p>
      <p v-if="!path" class="request-hint">Save your draft first.</p><p v-else-if="!requests.length && !loading && !error" class="request-hint">{{ truncated ? 'No requests for this article on this page. Load older requests to continue.' : 'No requests yet. Highlight text in your article, then choose an action.' }}</p>
      <article v-for="saved in requests" :key="saved.task.id" class="request-card">
        <div class="request-heading"><h3>{{ requestActions[saved.task.action] }}</h3><span class="request-status">{{ saved.task.status === 'open' ? 'Ready for agent' : saved.task.status === 'answered' ? 'Response ready' : 'Resolved' }}</span></div>
        <blockquote>{{ saved.task.anchor.quote }}</blockquote><p v-if="saved.task.instruction" class="request-message">{{ saved.task.instruction }}</p>
        <div v-if="saved.task.response" class="request-response"><h4>Agent response</h4><p class="request-message">{{ saved.task.response.message }}</p>
          <details v-if="saved.task.response.replacementHtml"><summary>Suggested editor HTML</summary><pre>{{ saved.task.response.replacementHtml }}</pre></details>
        </div>
        <div class="request-actions"><button class="btn btn-ghost" type="button" @click="copy(saved)">Copy context</button>
          <button v-if="saved.task.status !== 'resolved'" class="btn btn-ghost" type="button" :disabled="working || locked" @click="resolve(saved)">Resolve</button>
          <button v-if="saved.task.status !== 'resolved' && saved.task.response?.replacementHtml" class="btn btn-primary" type="button" :disabled="working || locked" @click="resolve(saved, true)">Review & apply</button>
        </div>
      </article>
      <button v-if="truncated && nextCursor" class="btn btn-ghost" type="button" :disabled="loading || working" @click="refresh(true)">Load older requests</button>
      <details v-if="copiedContext" open><summary>Request context to copy</summary><textarea readonly rows="10" aria-label="Request context to copy" :value="copiedContext" @focus="($event.target as HTMLTextAreaElement).select()" /></details>
    </aside>
  </div>
</template>

<style scoped>
.request-heading,.request-actions{display:flex;align-items:center;gap:.5rem;justify-content:space-between;flex-wrap:wrap}.request-heading{margin-bottom:.7rem}.request-heading h2,.request-heading h3,.request-response h4{font-weight:600}.request-hint{font-size:.8rem;color:var(--ink-soft);line-height:1.5}.selection-requests{position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);z-index:40;display:flex;flex-wrap:wrap;justify-content:center;gap:.2rem;width:max-content;max-width:calc(100vw - 2rem);padding:.4rem;background:var(--paper-card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:0 4px 20px #0002}.request-panel{position:fixed;right:0;top:0;bottom:0;z-index:45;width:min(29rem,100vw);overflow:auto;padding:1.25rem;background:var(--paper-card);border-left:1px solid var(--border);box-shadow:-4px 0 24px #0001}.request-panel>p{margin:.75rem 0}.request-card{margin-top:1rem;padding:1rem;border:1px solid var(--border);border-radius:var(--radius)}blockquote{margin:.7rem 0;padding-left:.7rem;border-left:2px solid var(--border);white-space:pre-wrap;overflow-wrap:anywhere;max-height:12rem;overflow:auto}.request-status{font-size:.75rem;color:var(--ink-soft)}.request-message{white-space:pre-wrap;overflow-wrap:anywhere;margin:.6rem 0}.request-response{border-top:1px solid var(--border);padding-top:.7rem;margin:.7rem 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.75rem;max-height:16rem;overflow:auto;margin:.7rem 0}.request-card .request-actions{justify-content:flex-start;margin-top:.8rem}.request-dialog{margin:auto;padding:1.5rem;width:calc(100vw - 2rem);max-width:34rem;max-height:85dvh;overflow:auto;background:var(--paper-card);border:1px solid var(--border);border-radius:var(--radius)}.request-dialog::backdrop{background:#0005}.request-dialog h2{font-size:1.2rem;font-weight:600}.request-dialog label{display:block;margin-top:1rem}.request-dialog p{margin:.8rem 0}textarea{display:block;width:100%;border:1px solid var(--border);border-radius:var(--radius);padding:.7rem;margin:.5rem 0;background:var(--paper);font:inherit}.request-dialog .request-actions{justify-content:flex-end}
@media(max-width:700px){.request-panel{position:relative;top:auto;right:auto;bottom:auto;width:100%;max-height:65dvh;border:1px solid var(--border);border-radius:var(--radius);margin:1rem 0;box-shadow:none}.selection-requests{bottom:.5rem;gap:0;padding:.2rem}.selection-requests .btn{font-size:.75rem;padding:.5rem}}
</style>
