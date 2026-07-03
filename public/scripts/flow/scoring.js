// state = { answers: { [nodeId]: { optionIds?: string[], value?: any } }, swipes: [{ liked, profileWeights }] }
export function scoreArchetypes(flow, state) {
  const scores = {};
  for (const a of flow.archetypes || []) scores[a.id] = 0;

  for (const node of flow.nodes || []) {
    const ans = state.answers ? state.answers[node.id] : null;
    if (!ans || !node.profileWeights) continue;
    for (const [arch, weight] of Object.entries(node.profileWeights)) {
      if (scores[arch] === undefined) scores[arch] = 0;
      if (typeof weight === "number") {
        scores[arch] += weight; // flat: awarded for answering the node at all
      } else {
        const chosen = ans.optionIds || (ans.value != null ? [String(ans.value)] : []);
        for (const opt of chosen) {
          if (weight[opt] != null) scores[arch] += weight[opt];
        }
      }
    }
  }

  for (const sw of state.swipes || []) {
    if (!sw.liked || !sw.profileWeights) continue;
    for (const [arch, pts] of Object.entries(sw.profileWeights)) {
      if (scores[arch] === undefined) scores[arch] = 0;
      scores[arch] += pts;
    }
  }
  return scores;
}

export function topArchetype(flow, state) {
  const scores = scoreArchetypes(flow, state);
  let best = (flow.archetypes[0] || {}).id || null;
  let bestScore = -Infinity;
  for (const a of flow.archetypes || []) {
    if (scores[a.id] > bestScore) { bestScore = scores[a.id]; best = a.id; }
  }
  return { id: best, scores };
}
