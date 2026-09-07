---
title: Get started
description: >-
  Create your Lanza site with GitHub and Cloudflare, connect an agent, make a first draft and review
  before publishing.
draft: false
template: landing
preset: product-guide
slots:
  eyebrow: GETTING STARTED
  title: Start with your own little corner of the web.
  intro: >-
    Lanza connects a site you own with an editor you can use. These are the pieces you need and the
    first things to do.
  sections:
    - title: Bring your accounts
      paragraphs:
        - text: >-
            You need GitHub for the repository and Cloudflare for the site. Use accounts you
            control: the finished site and its files belong to you.
        - text: >-
            A custom domain is optional. Agent access is optional for everyday editing, but useful
            for building and changing the design. Check your providers’ current plans and limits;
            domain and agent costs are separate.
    - title: Create the site
      paragraphs:
        - text: >-
            Open the setup flow, choose your site’s name and follow the GitHub and Cloudflare
            connection steps. Complete any provider authorization requested by the setup flow.
        - text: >-
            Let setup finish and check the reported build and site status. If something fails, use
            the actual error to resolve it before treating the site as ready.
      link:
        label: Open site setup
        href: https://connect.lanzacms.com/
    - title: Connect an agent
      paragraphs:
        - text: >-
            In your CMS, open Connect an agent. Use the site endpoint and credential instructions
            shown there to configure an MCP-capable client. Client support differs, so follow the
            connection method your client supports.
        - text: >-
            Enter credentials in the client’s credential settings, not in an ordinary conversation.
            Ask the agent to read get_site and describe_site_system before it starts building.
      link:
        label: Read the agent guide
        href: /agents/
    - title: Make the first version
      paragraphs:
        - text: >-
            Describe the pages you need and what you will edit yourself. Ask for the first version
            on staging. An agent can create templates, structured content and navigation; you can
            then refine the writing and images in the CMS.
        - text: >-
            Start with one useful page. You do not need a full content operation before you have
            something worth saying.
    - title: Review and publish
      paragraphs:
        - text: >-
            Open the CMS, check the content and review the staged changes. Try the preview at phone
            and desktop widths. Check links, images, language versions and search details.
        - text: >-
            Publish when that set of changes is ready. Wait for the site build, then verify the live
            result. For your next edit, come straight back to the CMS.
      link:
        label: Tour the editing workflow
        href: /how-it-works/
  nextTitle: Make a start.
  nextBody: Lanza is in beta. Bring a real project, start small and review before publishing.
  nextLabel: Create your site
  backLabel: ← Lanza
  backUrl: /
  indexLabel: IN THIS GUIDE
  nextUrl: https://connect.lanzacms.com/
---
