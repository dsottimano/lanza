// The sign-in screen (docs/security-todo.md §10.1, step 1).
//
// Device flow has nowhere to redirect to — the person reads a code off this screen
// and types it at github.com — so an unauthenticated /admin navigation RENDERS this
// instead of bouncing to an OAuth URL.
//
// It is a standalone page, not an SPA route, because the SPA lives BEHIND the gate:
// nothing under /admin/ is served until you are signed in, so the screen that signs
// you in cannot be part of the bundle. It ships as one self-contained file with one
// inline script, allowed by a per-response CSP nonce — `script-src 'self'` gives it
// no other way to run, and exempting a static asset from the gate would widen the
// unauthenticated surface for the sake of a 40-line poller.
//
// It holds no credential and learns none. `/start` returns only the user code and
// where to type it; `/poll` answers `{"status":"ok"}` and puts the tokens in
// HttpOnly cookies, so the only thing this page ever does with a success is reload.
//
// It deliberately does NOT offer the outgoing broker login as a second option. That
// login still works, but from phase 3 the proxy has no token for the session it
// produces — it would sign someone in to a CMS where every read fails. One way in
// that works beats two where one is a trap.

/** A fresh nonce per response — a reused one is the same as having none. */
function nonce(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

const STYLE = `
  :root { color-scheme: light; --ink:#141414; --paper:#faf9f7; --line:#dcd8d2; --muted:#6b6560; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:var(--paper); color:var(--ink); padding:1.5rem;
         font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { width:100%; max-width:26rem; border:1px solid var(--line); background:#fff; padding:2rem; }
  h1 { margin:0 0 .25rem; font-size:1.25rem; letter-spacing:.02em; text-transform:uppercase; }
  p { margin:0 0 1rem; line-height:1.55; font-size:.925rem; color:var(--muted); }
  ol { margin:0 0 1rem; padding-left:1.15rem; font-size:.925rem; color:var(--muted); line-height:1.8; }
  button { width:100%; padding:.7rem 1rem; border:1px solid var(--ink); background:var(--ink);
           color:#fff; font:inherit; font-size:.925rem; cursor:pointer; }
  button[disabled] { opacity:.5; cursor:default; }
  a { color:var(--ink); }
  .code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:1.75rem;
          letter-spacing:.18em; color:var(--ink); text-align:center; border:1px dashed var(--line);
          padding:.75rem; margin:0 0 1rem; }
  .status { font-size:.85rem; }
  .error { color:#9b1c1c; font-size:.875rem; }
  .foot { margin:1.5rem 0 0; padding-top:1rem; border-top:1px solid var(--line); font-size:.8rem; }
`;

// The poller. Honours GitHub's own interval (polling faster earns `slow_down`,
// which costs more time than it saves) and stops at the code's expiry rather than
// asking forever about a code GitHub has already forgotten.
const SCRIPT = `
(function () {
  var begin = document.getElementById('begin');
  var codeStep = document.getElementById('step-code');
  var startStep = document.getElementById('step-start');
  var errBox = document.getElementById('error');
  var status = document.getElementById('status');
  var deadline = 0;

  function fail(message, again) {
    errBox.textContent = message;
    errBox.hidden = false;
    if (again) { startStep.hidden = false; codeStep.hidden = true; begin.disabled = false;
                 begin.textContent = 'Try again'; }
  }

  function post(path) {
    return fetch(path, { method: 'POST', headers: { accept: 'application/json' } })
      .then(function (r) { return r.json().then(function (b) { return { status: r.status, body: b }; }); });
  }

  function poll(interval) {
    if (Date.now() > deadline) { fail('This code expired before it was entered.', true); return; }
    post('/admin/api/auth/device/poll').then(function (res) {
      var b = res.body || {};
      if (b.status === 'ok') { status.textContent = 'Signed in. Loading the CMS…'; location.reload(); return; }
      if (b.status === 'pending') { setTimeout(function () { poll(b.interval || interval); }, (b.interval || interval) * 1000); return; }
      if (b.status === 'restart') { fail('This sign-in expired. Start again.', true); return; }
      fail(b.error === 'access_denied' ? 'That sign-in was declined at GitHub.'
           : 'GitHub would not complete the sign-in (' + (b.error || res.status) + ').', true);
    }).catch(function () { setTimeout(function () { poll(interval); }, interval * 1000); });
  }

  begin.addEventListener('click', function () {
    begin.disabled = true;
    begin.textContent = 'Asking GitHub…';
    errBox.hidden = true;
    post('/admin/api/auth/device/start').then(function (res) {
      var b = res.body || {};
      if (res.status !== 200 || !b.userCode) {
        fail('GitHub would not start a sign-in (' + (b.error || res.status) + ').', true);
        return;
      }
      document.getElementById('code').textContent = b.userCode;
      var link = document.getElementById('verify');
      link.href = b.verificationUri;
      link.textContent = b.verificationUri.replace(/^https?:\\/\\//, '');
      startStep.hidden = true;
      codeStep.hidden = false;
      deadline = Date.now() + (b.expiresIn || 900) * 1000;
      setTimeout(function () { poll(b.interval || 5); }, (b.interval || 5) * 1000);
    }).catch(function () { fail('Could not reach the sign-in service.', true); });
  });
})();
`;

/**
 * The page, plus the nonce its inline script needs in the response's CSP. The two
 * are returned together so a caller cannot serve one without the other — a page
 * whose script the policy blocks is a button that does nothing.
 */
export function signInPage(): { html: string; nonce: string } {
  const n = nonce();
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · Lanza</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <h1>Lanza</h1>
  <p>Sign in with the GitHub account that has access to this site's repository.</p>

  <div id="step-start">
    <button id="begin" type="button">Get a sign-in code</button>
  </div>

  <div id="step-code" hidden>
    <ol>
      <li>Open <a id="verify" href="https://github.com/login/device" target="_blank" rel="noopener noreferrer">github.com/login/device</a></li>
      <li>Enter this code:</li>
    </ol>
    <p class="code" id="code"></p>
    <p class="status" id="status">Waiting for you to finish at GitHub…</p>
  </div>

  <p class="error" id="error" hidden></p>
  <p class="foot">A code lasts 15 minutes. Nothing is stored in this page — your
  GitHub session lives in a cookie the browser cannot read.</p>
</main>
<script nonce="${n}">${SCRIPT}</script>
</body>
</html>`;
  return { html, nonce: n };
}
