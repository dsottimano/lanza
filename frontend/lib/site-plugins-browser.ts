export function mountSitePlugins(config: HTMLElement) {
  if (config.dataset.mounted) return;
  config.dataset.mounted = 'true';
  const spanish = document.documentElement.lang.startsWith('es');
  const imageLabel = spanish ? 'Imagen' : 'Image';
  const article = document.querySelector<HTMLElement>('article.post-body, article.starter');
  if (config.hasAttribute('data-reading-progress') && article) {
    const bar = document.createElement('div');
    bar.className = 'lanza-reading-progress';
    bar.setAttribute('aria-hidden', 'true');
    bar.style.cssText = 'position:fixed;inset:0 0 auto;height:3px;background:var(--accent,#333);transform-origin:left;pointer-events:none;z-index:1000';
    document.body.append(bar);
    let queued = false;
    const update = () => {
      queued = false;
      const rect = article.getBoundingClientRect();
      const distance = rect.height - innerHeight;
      const progress = distance > 0 ? Math.max(0, Math.min(1, -rect.top / distance)) : 0;
      bar.style.transform = `scaleX(${progress})`;
    };
    const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule);
    new ResizeObserver(schedule).observe(article);
    update();
  }
  if (config.hasAttribute('data-image-zoom')) {
    const dialog = document.createElement('dialog');
    if (typeof dialog.showModal !== 'function') return;
    dialog.className = 'lanza-image-zoom';
    dialog.setAttribute('aria-label', imageLabel);
    dialog.style.cssText = 'padding:1rem;border:1px solid #777;background:#111;color:white;max-width:96vw;max-height:96vh';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', spanish ? 'Cerrar' : 'Close');
    close.style.cssText = 'display:block;margin:0 0 .75rem auto;padding:.4rem 1rem;font-size:1.5rem;cursor:pointer;background:white;color:black;border:1px solid #777';
    const image = document.createElement('img');
    image.style.cssText = 'display:block;max-width:88vw;max-height:78vh;object-fit:contain';
    dialog.append(close, image);
    document.body.append(dialog);
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
    document.querySelectorAll<HTMLImageElement>('.post-body img, .starter .st-body img, .starter .st-gallery img').forEach(source => {
      if (source.closest('a,button,[role="button"]') || !source.getAttribute('src')) return;
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.setAttribute('aria-label', source.alt || imageLabel);
      trigger.setAttribute('aria-haspopup', 'dialog');
      trigger.style.cssText = 'display:block;max-width:100%;padding:0;border:0;background:transparent;cursor:zoom-in';
      source.replaceWith(trigger);
      trigger.append(source);
      trigger.addEventListener('click', () => {
        image.src = source.currentSrc || source.src;
        image.alt = source.alt;
        dialog.setAttribute('aria-label', source.alt || imageLabel);
        dialog.showModal();
        close.focus();
      });
    });
  }
}
