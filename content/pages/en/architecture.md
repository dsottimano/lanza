---
title: Architecture
description: >-
  Every moving part named: what runs where, who holds which secret and for how long, how signing in
  actually works, and what an agent is allowed to touch.
draft: false
template: landing
preset: architecture
slots:
  tag: ARCHITECTURE · THE WHOLE MACHINE
  headline: Every moving part, named.
  sub: >-
    How it works is the story of an edit. This is the wiring behind it: what each piece is, who runs
    it, which secrets it holds, and how long they live. Nothing here is a diagram of an ideal. It is
    what the code does, and where the code used to do something worse, it says so.
  partsEyebrow: The parts
  partsHead: Six pieces. You own five of them.
  partsIntro: >-
    There is no application server anywhere in this list. Your site is compiled to files ahead of
    time, and the only thing that ever runs on a request is Cloudflare handing one over. The one
    piece we operate is not on the path of anything you do after your first day.
  partsCols:
    - text: Piece
    - text: What it actually is
    - text: Who runs it
    - text: Holds secrets
  parts:
    - name: Your repository
      what: Markdown and HTML files on GitHub. The source of truth for every word on your site.
      who: You
      secrets: 'No'
    - name: Your site
      what: An Astro static build, served by Cloudflare Pages. Plain HTML by the time a visitor sees it.
      who: You
      secrets: 'No'
    - name: Lanza, the CMS
      what: A Vue app at /admin. Static files, with no backend of its own.
      who: You
      secrets: 'No'
    - name: lanza-site
      what: The npm package holding the render code and the site's server functions. You pin a version.
      who: You
      secrets: 'No'
    - name: The broker
      what: >-
        connect.lanzacms.com. It creates your repository and your Pages project during onboarding,
        and then has nothing further to do with your site.
      who: Lanza
      secrets: Two, for onboarding only
    - name: /api/mcp
      what: The endpoint an AI agent connects to in order to edit your site.
      who: You
      secrets: 'No'
  editEyebrow: Life of an edit
  editHead: Save writes to a branch. Publish is a merge.
  editIntro: >-
    The CMS never writes to your live site. It writes to a staging branch, and publishing is an
    ordinary git merge, which is why every change is reversible and nothing is ever half-applied.
  editSteps:
    - t: You save
      c: PUT → staging
      b: >-
        The CMS commits to the staging branch through its own /admin/api/gh proxy. Your browser
        never holds the GitHub token: it lives in a cookie JavaScript cannot read, and the proxy
        attaches it server-side, checking on every single request that the endpoint is one the CMS
        is allowed to call and that the resolved URL still points at your repository and no other.
    - t: You review
      c: staging.<project>.pages.dev
      b: >-
        Cloudflare builds the staging branch too, so there is a real URL showing exactly what you
        just wrote, before anyone else can see it.
    - t: You publish
      c: merge staging → main
      b: One merge. No separate deploy step and no copy of your content living anywhere else.
    - t: Cloudflare rebuilds
      c: astro build → dist
      b: >-
        The push to main triggers a static build. Entries marked draft never render, whether or not
        they were merged.
    - t: You change your mind
      c: git revert
      b: >-
        Every version is a commit. Rolling back is the same operation a developer would use, and the
        CMS keeps theme history for the same reason.
  authEyebrow: Signing in
  authHead: There is no secret. Anywhere.
  authIntro: >-
    Signing in is GitHub Device Flow, which is the flow built for televisions and terminals: it
    needs a public client id and nothing else. Your site holds no signing key, no client secret and
    no password hash, because at no point does the design call for one.
  authSteps:
    - text: >-
        You open /admin. It shows you a short code and sends you to github.com to approve it.
        Nothing redirects, so there is no callback URL to get wrong and no token in a URL to leak.
    - text: >-
        Your browser exchanges that approval for a GitHub token, which is stored in an HttpOnly
        cookie. The device code never reaches the page; the token never reaches JavaScript.
    - text: 'On every request, the gate asks GitHub who you are: GET /user.'
    - text: >-
        Separately, on the same request, it asks GitHub what you may do here: GET /repos/owner/name,
        and reads the permissions object GitHub returns.
    - text: >-
        Admin becomes owner, push becomes editor, pull becomes viewer. The answer is cached for
        sixty seconds and no longer.
    - text: >-
        The token lives eight hours and refreshes silently for one hundred and eighty-four days, so
        you type a code once per browser and then effectively never again.
  authCalloutHead: Why the role is a question, not a list
  authCalloutBody: >-
    There used to be a list of usernames in your repository saying who could edit. It is gone, and
    the reason is worth stating: a list of ours is a second answer to a question GitHub already
    answers, and it was the weaker answer. It could disagree with who can actually write the
    repository, it only took effect after a publish and a rebuild, and removing someone from it did
    not take their access away. Asking GitHub costs one cached request and is right by construction.
    Remove a collaborator and they are locked out within a minute.
  keysEyebrow: Blast radius
  keysHead: Everything is your own credential, or nothing at all.
  keysIntro: >-
    The useful question about a credential is not whether it is encrypted. It is what someone
    reaches if they hold it, for how long, and who can take it away.
  keysCols:
    - text: Credential
    - text: Reaches
    - text: Lifetime
  keys:
    - cred: Your sign-in cookie
      reaches: >-
        Your GitHub token, for your repositories. HttpOnly, Secure, scoped to /admin so it never
        rides a public page
      life: 8 hours, refreshed
    - cred: Your agent token
      reaches: The same, for an AI agent you hand it to. Revoked in one click at GitHub
      life: until you revoke it
    - cred: Your site's own key material
      reaches: Nothing. There is none
      life: none
    - cred: What the broker holds about your site
      reaches: Nothing. No key, no token, no record
      life: none
    - cred: What we could deploy to your site
      reaches: Nothing. There is no credential anywhere that would let us
      life: none
  agentEyebrow: For agents
  agentHead: An agent edits your site as you, with your credential.
  agentBody: >-
    Your site exposes an MCP endpoint. The bearer it takes is a GitHub token you authorize yourself,
    from Settings, and paste into your agent alongside the endpoint URL. The site validates it by
    asking GitHub the same two questions it asks when you sign in, so an agent can never do more
    than you can, and the tools are confined on top of that: an entry write has to be a markdown
    file inside a folder one of your content types declares. This used to be a one-click OAuth
    popup, and we took it out. That flow required us to run an authorization server that could mint
    a credential for your site, which is precisely the power this release exists to remove. One
    paste, and nobody holds a key to your site but you.
  agentLink: Read the agent contract
  costEyebrow: What it costs to run
  costHead: Static sites are cheap because nothing is running.
  costBody: >-
    Page views on Cloudflare Pages are unmetered, so there is no per-visit cost and no traffic level
    at which your bill starts moving. There is no database to pay for and no server sitting idle,
    because there is no server. The only recurring cost is your domain name, which you buy from
    whoever you like and point wherever you like.
  costTiles:
    - value: $0
      label: to build, host and serve
    - value: ~$12
      label: a year for a domain, the only bill
    - value: '0'
      label: databases, servers, and things to patch
  sovEyebrow: The line we drew
  sovHead: Once you install, we cannot reach your site.
  sovIntro: >-
    This is the claim worth checking, so here is what it means precisely, and what it cost to make
    true.
  sovBeforeLabel: Before
  sovAfterLabel: After
  sovBefore: >-
    Until August 2026, our onboarding service held a GitHub App private key. That key could mint a
    write token for every repository the app was installed on, which is every customer site. And
    repository write is not a small thing on a static host: Cloudflare rebuilds from your repository
    on every push, so whoever controls your build file controls what your visitors are served. One
    compromised service, every site.
  sovAfter: >-
    That key is deleted, along with everything that used it. Our service now holds two OAuth client
    secrets, both of which are useless without a person actively clicking approve, and neither of
    which touches a site that already exists.
  sovRows:
    - what: A private key that could write every customer repository
      state: Deleted
    - what: A signing key that could forge a login for any site
      state: Deleted
    - what: An endpoint that traded a signature for a repository token
      state: Deleted
    - what: The ability to push a fix into your repository unasked
      state: Deleted
    - what: An authorization server that could mint an agent credential for your site
      state: Deleted
  sovHonestHead: The part that is still true
  sovHonestBody: >-
    The GitHub app stays installed on your repository, because that install is what lets your own
    sign-in reach it. Whoever administers that app can generate a new key. So the honest statement
    is not that the risk is zero: it is that reaching your site now requires compromising a GitHub
    account belonging to a person, rather than a running web service. That is a much smaller and
    much slower target, and you can close it entirely by removing the app from your repository,
    which cuts every token for your site at once.
  ownEyebrow: Updates, and leaving
  ownHead: You pin the version. You keep the files.
  ownBody: >-
    Your site depends on a published package at a version you choose, so an improvement we ship does
    not change your site until you take it, from Settings, when it suits you. We used to be able to
    push a critical fix into your repository without asking. That is gone with everything else, and
    what replaced it is a build that refuses to deploy a version marked unsafe: your live site keeps
    serving, nothing new goes out, and you are told exactly what to change. Slower, and it is your
    hand on it. The exit was never a feature we had to build, because your content is already a
    folder of ordinary files in a repository you own, and the package is public.
  ctaHead: Read the plain-language version.
  ctaSub: Same machine, told as a story instead of a diagram.
  cta: How it works
  agentUrl: /agents/
  ctaUrl: /how-it-works/
---
