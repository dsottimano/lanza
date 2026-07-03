export function getNode(flow, id) {
  return (flow.nodes || []).find((n) => n.id === id) || null;
}

// answer: { optionId? } — optionId only used to pick a per-option branch.
export function resolveNext(flow, currentId, answer = {}) {
  const edges = (flow.edges || []).filter((e) => e.source === currentId);
  if (answer && answer.optionId) {
    const branch = edges.find((e) => e.sourceOption === answer.optionId);
    if (branch) return branch.target;
  }
  const def = edges.find((e) => !e.sourceOption);
  return def ? def.target : null;
}
