// mountSwipeDeck(container, cards, onComplete)
//   container: HTMLElement to render the deck into
//   cards: [{ id, label, kind, image, profileWeights }]
//   onComplete: (results) => void  where results = [{ id, liked, profileWeights }]
export function mountSwipeDeck(container, cards, onComplete) {
  const results = [];
  let index = 0;

  const stack = document.createElement("div");
  stack.className = "swipe-stack";
  container.appendChild(stack);

  function render() {
    stack.innerHTML = "";
    const remaining = cards.slice(index, index + 3).reverse();
    remaining.forEach((card, i) => {
      const depth = remaining.length - 1 - i; // 0 = top
      const el = document.createElement("div");
      el.className = "swipe-card";
      el.style.transform = `scale(${1 - depth * 0.05}) translateY(${depth * 14}px)`;
      el.style.zIndex = String(10 - depth);
      el.innerHTML = `
        <div class="qcard__bg" style="background-image:linear-gradient(180deg,rgba(8,20,28,.2),rgba(8,20,28,.9)),url('${card.image}')"></div>
        <div class="swipe-stamp swipe-stamp--yes">Love ◊</div>
        <div class="swipe-stamp swipe-stamp--no">Pass</div>
        <div class="qbody">
          <div class="qkicker">${card.kind}</div>
          <h2 class="qtitle" style="font-size:1.6rem">${card.label}</h2>
          <div class="swipe-hint"><span>‹ Pass</span><span>Love ›</span></div>
        </div>`;
      if (depth === 0) attachDrag(el, card);
      stack.appendChild(el);
    });
  }

  function attachDrag(el, card) {
    let startX = 0, dx = 0, dragging = false;
    const onDown = (e) => { dragging = true; startX = pointX(e); el.style.transition = "none"; };
    const onMove = (e) => {
      if (!dragging) return;
      dx = pointX(e) - startX;
      el.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
      el.querySelector(".swipe-stamp--yes").style.opacity = dx > 0 ? Math.min(dx / 80, 1) : 0;
      el.querySelector(".swipe-stamp--no").style.opacity = dx < 0 ? Math.min(-dx / 80, 1) : 0;
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      el.style.transition = "transform .3s ease";
      if (Math.abs(dx) > 90) {
        commit(card, dx > 0, el);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      } else {
        el.style.transform = "translateX(0) rotate(0)";
      }
      dx = 0;
    };
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function commit(card, liked, el) {
    el.style.transform = `translateX(${liked ? 600 : -600}px) rotate(${liked ? 30 : -30}deg)`;
    results.push({ id: card.id, liked, profileWeights: card.profileWeights || {} });
    index += 1;
    setTimeout(() => {
      if (index >= cards.length) onComplete(results);
      else render();
    }, 260);
  }

  const pointX = (e) => (e.touches ? e.touches[0].clientX : e.clientX);
  render();

  // expose programmatic buttons for accessibility / no-drag fallback
  return {
    like: () => { const top = cards[index]; if (top) commit(top, true, stack.lastChild); },
    pass: () => { const top = cards[index]; if (top) commit(top, false, stack.lastChild); },
  };
}
