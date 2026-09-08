import { afterEach, expect, it, vi } from 'vitest';
import { mountSitePlugins } from '../../../frontend/lib/site-plugins-browser';
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });
it('zooms starter body and gallery images while preserving existing image links', () => {
  document.body.innerHTML = `<div data-site-plugins data-image-zoom></div>
    <article class="starter"><div class="st-body"><img src="/body.png" alt="Body image"></div>
    <div class="st-gallery"><figure><img src="/gallery.png" alt="Gallery image"><figcaption>Keep this caption</figcaption></figure></div>
    <div class="st-body"><a href="/original/"><img src="/linked.png" alt="Linked image"></a></div></article>`;
  const show = vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(() => {});
  mountSitePlugins(document.querySelector<HTMLElement>('[data-site-plugins]')!);
  expect(document.querySelectorAll('button[aria-haspopup="dialog"]')).toHaveLength(2);
  expect(document.querySelector('a')?.getAttribute('href')).toBe('/original/');
  expect(document.querySelector('a button')).toBeNull();
  expect(document.querySelector('figcaption')?.textContent).toBe('Keep this caption');
  document.querySelector<HTMLButtonElement>('.st-body button')!.click();
  expect(show).toHaveBeenCalledOnce();
  expect(document.querySelector('dialog img')?.getAttribute('alt')).toBe('Body image');
  mountSitePlugins(document.querySelector<HTMLElement>('[data-site-plugins]')!);
  expect(document.querySelectorAll('dialog')).toHaveLength(1);
});
