import { describe, it, expect } from "vitest";
import { isSafeUrl, serializeMenu, emptyMenu, type SiteMenu } from "./menu";

// Menu items become `<a href="{{ url }}">` in templates/parts/header.html and
// footer.html, so a `javascript:` URL here executes on the site's own origin — the
// origin that carries the Path=/admin session cookie and where /admin/api/gh/* is
// whole-repo write. The render side is authoritative (frontend/lib/template-render
// applies the same policy), but the CMS must not commit a link it knows the site
// will refuse to render, and it must say so instead of warning in amber.
//
// "Nothing was written" here means: serializeMenu throws, so save() never reaches
// client.saveJson and no commit is made.

function menuWith(url: string): SiteMenu {
  const m = emptyMenu();
  m.header.desktop.push({ label: "x", url });
  return m;
}

describe("menu URL policy", () => {
  it("mirrors frontend/lib/url.ts", () => {
    for (const ok of ["https://x.test/a", "http://x.test", "mailto:a@b.c", "tel:+1", "/about", "#top", ""]) {
      expect(isSafeUrl(ok), ok).toBe(true);
    }
    for (const bad of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", " javascript:alert(1)", "data:text/html,x", "vbscript:x", "//evil.test"]) {
      expect(isSafeUrl(bad), bad).toBe(false);
    }
  });

  it("refuses to serialize an unsafe link — the save cannot proceed", () => {
    for (const bad of ["javascript:alert(document.cookie)", "data:text/html,<script>x</script>", "//evil.test"]) {
      expect(() => serializeMenu(menuWith(bad))).toThrow(/Unsafe menu link/);
    }
  });

  it("checks every location and device, not just header/desktop", () => {
    const m = emptyMenu();
    m.footer.mobile = [{ label: "x", url: "javascript:alert(1)" }];
    expect(() => serializeMenu(m)).toThrow(/Unsafe menu link/);
  });

  it("still serializes an ordinary menu, half-filled rows included", () => {
    const m = emptyMenu();
    m.header.desktop.push({ label: "Blog", url: "/posts" }, { label: "", url: "" });
    m.footer.desktop.push({ label: "Legal", url: "https://x.test/legal" });
    expect(serializeMenu(m).locations.header.desktop[0]).toEqual({ label: "Blog", url: "/posts" });
  });
});
