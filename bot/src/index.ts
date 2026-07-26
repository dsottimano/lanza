import { Bot, webhookCallback } from "grammy";

export interface Env {
  BOT_TOKEN: string;
  BOT_INFO: string;
  WEBHOOK_SECRET: string;
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  CONTENT_DIR: string;
  /** Comma-separated Telegram chat IDs allowed to use the bot. Empty = deny all. */
  ALLOWED_CHAT_IDS: string;
  /**
   * Comma-separated Telegram USER IDs allowed to use the bot. Empty = don't check the
   * sender, which is right for a private chat and wrong for a group: a group id in
   * ALLOWED_CHAT_IDS otherwise grants repo write to every current and future member.
   */
  ALLOWED_USER_IDS?: string;
}

// Compare the webhook secret without short-circuiting on the first differing byte.
// The remote-timing signal is buried under network jitter, so this is hygiene rather
// than a live hole — but it costs nothing, and `!==` on a secret is a habit worth not
// having. Length is compared first and is not itself secret.
function secretEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function idSet(raw: string | undefined): Set<number> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n !== 0),
  );
}

function allowedChatIds(env: Env): Set<number> {
  return idSet(env.ALLOWED_CHAT_IDS);
}

// Optional second gate. Empty means "don't check the sender" — correct for a private
// chat, where the chat id is the person. Set it when a chat id is a GROUP.
function allowedUserIds(env: Env): Set<number> {
  return idSet(env.ALLOWED_USER_IDS);
}

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  // Non-Latin titles (CJK/Cyrillic/Arabic) reduce to empty; date-stamp them so
  // drafts stay identifiable instead of piling up as untitled.md.
  return slug || `draft-${new Date().toISOString().slice(0, 10)}`;
}

/** UTF-8 safe base64 (btoa alone mangles multi-byte chars). */
function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function draftMarkdown(title: string, body: string): string {
  // Strip control characters BEFORE escaping. `split("\n")` already guarantees no
  // newline and `.trim()` removes a trailing CR, but a mid-string CR or NUL survives
  // both — and YAML rejects each outright ("deficient indentation", "null byte is not
  // allowed in input"). That is a build-breaker, not a cosmetic bug: the file commits
  // to the branch Astro builds from, the content collection fails to parse, and the
  // whole site stops deploying until someone deletes it by hand. `draft: true` is no
  // protection — the draft gate runs after frontmatter parsing.
  const printableTitle = title.replace(/[\u0000-\u001F\u007F]/g, " ");
  // Escape backslashes first, then quotes: inside a double-quoted YAML scalar a
  // lone `\` starts an escape sequence, so a trailing/embedded backslash would
  // otherwise corrupt the frontmatter (e.g. swallow the closing quote).
  const safeTitle = printableTitle.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return [
    "---",
    `title: "${safeTitle}"`,
    `pubDate: ${new Date().toISOString()}`,
    "draft: true",
    'description: ""',
    "seo:",
    '  metaTitle: ""',
    '  metaDescription: ""',
    '  ogImage: ""',
    "---",
    "",
    body,
    "",
  ].join("\n");
}

/**
 * Commit a draft markdown file via the GitHub Contents API. Two messages that
 * slugify to the same name would collide (creating without a sha fails once the
 * file exists), so retry under `-2`, `-3`, … until a free filename is found.
 */
async function createDraft(env: Env, title: string, body: string): Promise<string> {
  const baseSlug = slugify(title);
  const content = utf8ToBase64(draftMarkdown(title, body));

  for (let attempt = 1; attempt <= 5; attempt++) {
    const slug = attempt === 1 ? baseSlug : `${baseSlug}-${attempt}`;
    const path = `${env.CONTENT_DIR}/${slug}.md`;
    const res = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "telegram-draft-bot",
        },
        body: JSON.stringify({
          message: `draft: ${title} (via telegram)`,
          content,
          branch: env.GITHUB_BRANCH,
        }),
      },
    );
    if (res.ok) return path;
    // 422 (file exists, no sha) / 409 (ref conflict) → the name is taken; try the
    // next suffix. Anything else is a real error.
    if (res.status !== 422 && res.status !== 409) {
      throw new Error(`GitHub ${res.status}: ${await res.text()}`);
    }
  }
  throw new Error("Couldn't find a free filename for the draft after 5 tries.");
}

function buildBot(env: Env): Bot {
  const bot = new Bot(env.BOT_TOKEN, { botInfo: JSON.parse(env.BOT_INFO) });

  // Authorization: only allow-listed chats reach the handlers. Fail closed —
  // an empty/unset allowlist drops every update (silently, to avoid being a
  // reply amplifier for unknown senders).
  //
  // The allowlist gates the CHAT, not the sender. For a private chat those are the
  // same thing; for a group or supergroup id they are not — every member, including
  // anyone added later by someone else, would inherit the bot's repo-write token.
  // ALLOWED_USER_IDS narrows it to specific senders; leave it unset for the private-
  // chat case, where the chat id already identifies one person.
  const allowed = allowedChatIds(env);
  const allowedUsers = allowedUserIds(env);
  bot.use(async (ctx, next) => {
    if (!ctx.chat || !allowed.has(ctx.chat.id)) return;
    if (allowedUsers.size && !(ctx.from && allowedUsers.has(ctx.from.id))) return;
    await next();
  });

  bot.command("start", (ctx) =>
    ctx.reply(
      "Send me a message to create a *draft* post.\n\n" +
        "First line = title, the rest = body.\n" +
        "Nothing publishes automatically — review & publish drafts in the CMS.",
      { parse_mode: "Markdown" },
    ),
  );

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) return; // ignore unrecognised commands
    const [firstLine, ...rest] = text.split("\n");
    const title = firstLine.trim();
    if (!title) {
      await ctx.reply("Send a title on the first line.");
      return;
    }
    try {
      const path = await createDraft(env, title, rest.join("\n").trim());
      await ctx.reply(`✅ Draft created:\n\`${path}\`\n\nReview & publish it in the CMS.`, {
        parse_mode: "Markdown",
      });
    } catch (err) {
      // Log details server-side; never echo internal/API errors to the user.
      console.error("createDraft failed:", err);
      // The failure reply can itself fail (Telegram 429/5xx, or the webhook timeout).
      // Unguarded, that rejection escapes fetch(), the Worker 500s, and Telegram
      // RETRIES the same update — re-entering createDraft and burning GitHub
      // subrequests against the account-wide free-tier budget on every retry.
      await ctx.reply("⚠️ Couldn't create the draft. Try again later.").catch(() => {});
    }
  });

  // Last resort: a handler that throws must not become a 500, for the retry-loop
  // reason above. grammY swallows the error once it has been observed here.
  bot.catch((err) => console.error("bot error:", err));

  return bot;
}

// env is stable per deployment, so build the bot (and its webhook handler) once
// and reuse it across requests instead of re-parsing BOT_INFO every time. env
// isn't available at module scope, so init lazily on the first request.
type WebhookHandler = (request: Request) => Promise<Response>;
let handler: WebhookHandler | undefined;

function getHandler(env: Env): WebhookHandler {
  if (!handler) handler = webhookCallback(buildBot(env), "cloudflare-mod");
  return handler;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") return new Response("ok");
    // Verify Telegram's secret-token header before doing any work. Fail closed:
    // a missing/empty WEBHOOK_SECRET rejects every request rather than waving it through.
    if (
      !env.WEBHOOK_SECRET ||
      !secretEquals(request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "", env.WEBHOOK_SECRET)
    ) {
      return new Response("unauthorized", { status: 401 });
    }
    let webhook: WebhookHandler;
    try {
      webhook = getHandler(env);
    } catch (err) {
      // Misconfig (e.g. malformed BOT_INFO JSON). Log once, return a terse 500 —
      // never leak the underlying error or any secret to the caller.
      console.error("bot init failed:", err);
      return new Response("misconfigured", { status: 500 });
    }
    return webhook(request);
  },
};
