/**
 * window.lanza — exposes this page to visiting AI agents.
 *
 * A Lanza site treats LLMs as first-class visitors. This script is static,
 * dependency-free, and loads (deferred) on every public page. An agent driving
 * the browser can introspect the page through `window.lanza`.
 *
 * Phase 1 is read-only. Manipulation (scrollTo/highlight/setTheme) and a
 * reader-shared scratchpad come in Phase 2 — see `comingSoon` in help().
 */
(function () {
  "use strict";

  var VERSION = "0.1.0";

  function meta(name) {
    var el = document.querySelector(
      'meta[name="' + name + '"], meta[property="' + name + '"]'
    );
    return el ? el.getAttribute("content") : null;
  }

  // The authored body is <article class="post-body">; fall back to broader
  // containers so the API still works on listing/taxonomy pages.
  function mainEl() {
    return (
      document.querySelector("article.post-body, main, [role=main]") ||
      document.body
    );
  }

  function headings() {
    var nodes = mainEl().querySelectorAll("h1, h2, h3, h4");
    return Array.prototype.map.call(nodes, function (h) {
      return {
        level: Number(h.tagName.charAt(1)),
        text: (h.textContent || "").trim(),
        id: h.id || null,
      };
    });
  }

  function text() {
    return (mainEl().innerText || "").replace(/\n{3,}/g, "\n\n").trim();
  }

  var lanza = {
    version: VERSION,

    help: function () {
      var doc = {
        message:
          "You are on a Lanza-powered site that treats AI agents as " +
          "first-class visitors. This is a read-only API (Phase 1).",
        read: {
          "lanza.page": "facts about this page (title, url, type, description, headings, wordCount)",
          "lanza.toc()": "array of this page's headings",
          "lanza.content()": "main text content of this page as a string",
          "lanza.site": "site name + pointer to /llms.txt (the agent index)",
        },
        comingSoon: [
          "lanza.scratchpad — notes shared with the human reader",
          "lanza.scrollTo() / lanza.highlight() / lanza.setTheme()",
        ],
      };
      try {
        console.info("🤖 window.lanza", doc);
      } catch (e) {}
      return doc;
    },

    get page() {
      var canonical = document.querySelector("link[rel=canonical]");
      return {
        title: document.title,
        url: location.href,
        canonical: (canonical && canonical.href) || location.href,
        type: meta("og:type") || "website",
        description: meta("description"),
        headings: headings(),
        wordCount: text().split(/\s+/).filter(Boolean).length,
      };
    },

    get site() {
      return {
        name: meta("og:site_name") || document.title,
        llms: new URL("/llms.txt", location.origin).href,
        agentApi: meta("lanza:agent-api"),
      };
    },

    toc: headings,
    content: text,
  };

  // Non-writable so a page script can't trivially clobber it; the object's own
  // methods stay extensible for Phase 2.
  Object.defineProperty(window, "lanza", {
    value: lanza,
    writable: false,
    configurable: true,
  });

  // Discovery breadcrumb for agents that read the console on load.
  try {
    console.info(
      "%c🤖 Agent? This site has an API for you. Call window.lanza.help()",
      "color:#5a8;font-weight:bold"
    );
  } catch (e) {}
})();
