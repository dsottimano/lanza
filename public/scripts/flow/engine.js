import { getNode, resolveNext } from "./graph.js";
import { topArchetype } from "./scoring.js";
import { mountSwipeDeck } from "./swipe.js";

const flow = JSON.parse(document.getElementById("flow-data").textContent);
// Listings are baked into the page at build time (#listings-data) so matching
// runs entirely client-side — the Worker only captures + emails the lead.
const listingsData = JSON.parse(document.getElementById("listings-data")?.textContent || "[]");
const root = document.getElementById("qroot");
const LOCALE = root.dataset.locale || "es";
const LEAD_ENDPOINT = root.dataset.leadEndpoint || "";
const LISTING_BASE = LOCALE === "en" ? "/en/properties/" : "/p/";
const state = { answers: {}, swipes: [], matches: [] };

const t = (obj, key) => (LOCALE === "en" ? (obj[`${key}_en`] ?? obj[key]) : obj[key]) ?? "";

// HTML-escape interpolated values. Listing data is editor-authored (CMS), so
// harden against a `"`/`<`/`')` in a title or image breaking out of the
// attribute / url() context when rendered via innerHTML.
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Only allow http(s)/relative URLs and strip chars that escape url()/attr contexts.
const safeUrl = (u) => {
  const s = String(u ?? "");
  if (!/^(https?:\/\/|\/)/.test(s)) return "";
  return s.replace(/[)'"\\]/g, "");
};

const total = flow.nodes.filter((n) => !["info", "reveal"].includes(n.type)).length;
let answered = 0;

const STR = {
  es: { continue: "Continuar", err: "Ingrese su nombre y un email válido.", per_month: "/ mes", see_all: "Ver propiedades", matches: "Sus propiedades sugeridas" },
  en: { continue: "Continue", err: "Please enter your name and a valid email.", per_month: "/ month", see_all: "View properties", matches: "Your suggested properties" },
}[LOCALE];

// ── client-side matching (ports plugins/laperle-flow/match.ts, camelCase) ──
function buildQueryPlan() {
  const arch = (flow.archetypes || []).find((a) => a.id === state.archetype);
  const move = state.answers?.n_move?.value;
  const listingType = move === "rent" ? "rent" : move === "buy" || move === "invest" ? "sale" : undefined;
  const budget = Number(state.answers?.n_budget?.value);
  const beds = Number(state.answers?.n_beds?.value);
  return {
    flowTags: arch?.flowTags ?? [],
    listingType,
    maxPrice: listingType === "sale" && budget > 0 ? budget : undefined,
    minBeds: beds > 0 ? beds : undefined,
  };
}

function rankListings(listings, plan, take = 3) {
  const candidates = listings.filter((l) => l.listingStatus === "active");
  const matchesType = (l) => !plan.listingType || l.listingType === plan.listingType || l.listingType === "sale_and_rent";
  const withinBudget = (l) => {
    if (!plan.maxPrice) return true;
    const p = plan.listingType === "rent" ? l.priceRent : l.priceSale;
    return !p || p <= plan.maxPrice;
  };
  const enoughBeds = (l) => !plan.minBeds || (l.bedrooms ?? 0) >= plan.minBeds;
  const scored = candidates
    .filter((l) => matchesType(l) && withinBudget(l) && enoughBeds(l))
    .map((l) => ({ l, score: (l.flowTags ?? []).filter((tag) => plan.flowTags.includes(tag)).length }))
    .sort((a, b) => b.score - a.score);
  const picked = scored.filter((s) => s.score > 0).map((s) => s.l);
  for (const s of scored) if (picked.length < take && !picked.includes(s.l)) picked.push(s.l);
  for (const l of candidates) if (picked.length < take && !picked.includes(l)) picked.push(l);
  return picked.slice(0, take);
}

function bgStyle(image) {
  return `background-image:linear-gradient(180deg,rgba(8,20,28,.2),rgba(8,20,28,.55) 55%,rgba(8,20,28,.92)),url('${image || ""}')`;
}

function shell(node) {
  const pct = Math.round((answered / total) * 100);
  return `
    <div class="qcard">
      <div class="qcard__bg" style="${bgStyle(node.image)}"></div>
      <div class="qtop"><span>PANAMÁ</span><span>${String(answered + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}</span></div>
      <div class="qprog"><div class="qprog__fill" style="width:${pct}%"></div></div>
      <div class="qbody">
        <div class="qkicker">${t(node, "kicker")}</div>
        <h2 class="qtitle">${t(node, "prompt")}</h2>
        <div id="q-controls"></div>
      </div>
    </div>`;
}

function advance(node, answer) {
  if (!["info"].includes(node.type)) answered += 1;
  const nextId = resolveNext(flow, node.id, answer);
  if (nextId) render(nextId);
}

function render(nodeId) {
  const node = getNode(flow, nodeId);
  if (!node) return;
  if (node.type === "info") return renderInfo(node);
  if (node.type === "reveal") return renderReveal(node);
  if (node.type === "swipe") return renderSwipe(node);
  root.innerHTML = shell(node);
  const controls = root.querySelector("#q-controls");
  if (node.type === "single") renderSingle(node, controls);
  else if (node.type === "multi") renderMulti(node, controls);
  else if (node.type === "range") renderRange(node, controls);
  else if (node.type === "capture") renderCapture(node, controls);
}

function renderInfo(node) {
  root.innerHTML = `
    <div class="qcard">
      <div class="qcard__bg" style="${bgStyle(node.image)}"></div>
      <div class="qbody" style="text-align:center;margin-top:auto;margin-bottom:auto">
        <div class="qkicker">${t(node, "kicker")}</div>
        <h2 class="qtitle" style="font-size:2.4rem">${t(node, "prompt")}</h2>
        <p style="font-weight:300;opacity:.85;margin-bottom:1.3rem">${t(node, "sub")}</p>
        <button class="qcta" id="q-info-next">${t(node, "cta") || STR.continue} ›</button>
      </div>
    </div>`;
  root.querySelector("#q-info-next").onclick = () => advance(node, {});
}

function renderSingle(node, controls) {
  node.options.forEach((opt) => {
    const el = document.createElement("button");
    el.className = "opt";
    el.innerHTML = `${t(opt, "label")} <span class="opt__dia">◊</span>`;
    el.onclick = () => {
      state.answers[node.id] = { optionIds: [opt.id], value: opt.value };
      advance(node, { optionId: opt.id });
    };
    controls.appendChild(el);
  });
}

function renderMulti(node, controls) {
  const chosen = new Set();
  node.options.forEach((opt) => {
    const el = document.createElement("button");
    el.className = "opt";
    el.innerHTML = `${t(opt, "label")} <span class="opt__dia">◊</span>`;
    el.onclick = () => {
      if (chosen.has(opt.id)) { chosen.delete(opt.id); el.classList.remove("is-on"); }
      else { chosen.add(opt.id); el.classList.add("is-on"); }
    };
    controls.appendChild(el);
  });
  const cta = document.createElement("button");
  cta.className = "qcta";
  cta.textContent = STR.continue;
  cta.onclick = () => {
    state.answers[node.id] = { optionIds: [...chosen] };
    advance(node, {});
  };
  controls.appendChild(cta);
}

function renderRange(node, controls) {
  const suffix = t(node, "suffix");
  const fmt = (v) => `${node.prefix || ""}${Number(v).toLocaleString()}${suffix ? " " + suffix : ""}`;
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="qrange-val" id="q-rv">${fmt(node.default)}</div>
    <input class="qrange" type="range" min="${node.min}" max="${node.max}" step="${node.step}" value="${node.default}">`;
  const input = wrap.querySelector("input");
  const out = wrap.querySelector("#q-rv");
  input.oninput = () => { out.textContent = fmt(input.value); };
  const cta = document.createElement("button");
  cta.className = "qcta";
  cta.textContent = STR.continue;
  cta.onclick = () => {
    state.answers[node.id] = { value: Number(input.value) };
    advance(node, {});
  };
  controls.appendChild(wrap);
  controls.appendChild(cta);
}

function renderSwipe(node) {
  const pct = Math.round((answered / total) * 100);
  root.innerHTML = `
    <div class="qcard">
      <div class="qtop"><span>PANAMÁ</span><span>${String(answered + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}</span></div>
      <div class="qprog"><div class="qprog__fill" style="width:${pct}%"></div></div>
      <div class="qkicker" style="margin-top:.9rem">${t(node, "kicker")}</div>
      <p style="font-weight:300;opacity:.7;font-size:.85rem;margin:.3rem 0 0">${t(node, "prompt")}</p>
      <div class="swipe-host" id="q-swipe-host"></div>
    </div>`;
  const host = root.querySelector("#q-swipe-host");
  const cards = (flow.swipeDeck[node.deck] || []).map((c) => ({ ...c, label: t(c, "label") }));
  mountSwipeDeck(host, cards, (results) => {
    state.swipes = results;
    advance(node, {});
  });
}

function renderCapture(node, controls) {
  const ph = LOCALE === "en"
    ? { name: "Full name", email: "Email", phone: "WhatsApp / phone" }
    : { name: "Nombre completo", email: "Email", phone: "WhatsApp / teléfono" };
  controls.innerHTML = `
    <input class="qinput" id="c-name" placeholder="${ph.name}" autocomplete="name">
    <input class="qinput" id="c-email" type="email" placeholder="${ph.email}" autocomplete="email">
    <input class="qinput" id="c-phone" placeholder="${ph.phone}" autocomplete="tel">
    <button class="qcta" id="c-submit">${t(node, "cta") || STR.continue} ›</button>
    <p id="c-err" style="color:#e0795f;font-size:.8rem;margin-top:.5rem"></p>`;
  controls.querySelector("#c-submit").onclick = () => {
    const contact = {
      name: controls.querySelector("#c-name").value.trim(),
      email: controls.querySelector("#c-email").value.trim(),
      phone: controls.querySelector("#c-phone").value.trim(),
    };
    if (!contact.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email)) {
      controls.querySelector("#c-err").textContent = STR.err;
      return;
    }
    state.contact = contact;
    state.archetype = topArchetype(flow, state).id;

    // Match locally, then fire-and-forget the lead capture (don't block the reveal).
    state.matches = rankListings(listingsData, buildQueryPlan(), 3);
    if (LEAD_ENDPOINT) {
      fetch(LEAD_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact,
          archetype: state.archetype,
          answers: state.answers,
          swipes: state.swipes,
          locale: LOCALE,
          source: "quiz",
        }),
      }).catch(() => {});
    }
    advance(node, {});
  };
}

function fmtPrice(m) {
  const p = m.listingType === "rent" ? m.priceRent : m.priceSale;
  if (!p) return "";
  return `$${Number(p).toLocaleString("en-US")}${m.listingType === "rent" ? " " + STR.per_month : ""}`;
}

function renderReveal(node) {
  const arch = (flow.archetypes || []).find((a) => a.id === state.archetype) || flow.archetypes[0];
  const cards = (state.matches || [])
    .map((m) => `
      <a class="match-card" href="${esc(LISTING_BASE + encodeURIComponent(m.slug))}">
        <div class="match-card__img" style="background-image:url('${safeUrl(m.image)}')"></div>
        <div class="match-card__body"><strong>${esc(m.title)}</strong><span>${esc(fmtPrice(m))}</span></div>
      </a>`)
    .join("");
  root.innerHTML = `
    <div class="qcard" style="overflow-y:auto">
      <div class="qcard__bg" style="${bgStyle(arch.image)}"></div>
      <div class="qbody" style="text-align:center;margin-top:auto">
        <div class="qkicker">${t(node, "kicker")}</div>
        <h2 class="qtitle" style="font-size:2.4rem">${t(arch, "name")}</h2>
        <p style="font-weight:300;opacity:.88;margin-bottom:1.2rem;line-height:1.6">${t(arch, "blurb")}</p>
        ${cards ? `<div class="qkicker" style="margin-bottom:.6rem">${STR.matches}</div><div class="match-grid">${cards}</div>` : ""}
        <a class="qcta" style="display:inline-block;text-decoration:none;margin-top:1rem" href="${LOCALE === "en" ? "/en/properties" : "/propiedades"}">${STR.see_all} ›</a>
      </div>
    </div>`;
}

const begin = document.getElementById("q-begin");
if (begin) begin.onclick = () => advance(getNode(flow, flow.startNode), {});
