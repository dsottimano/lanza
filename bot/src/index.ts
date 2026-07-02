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
}

function allowedChatIds(env: Env): Set<number> {
  return new Set(
    (env.ALLOWED_CHAT_IDS ?? "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n !== 0),
  );
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
  // Escape backslashes first, then quotes: inside a double-quoted YAML scalar a
  // lone `\` starts an escape sequence, so a trailing/embedded backslash would
  // otherwise corrupt the frontmatter (e.g. swallow the closing quote).
  const safeTitle = title.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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
  const allowed = allowedChatIds(env);
  bot.use(async (ctx, next) => {
    if (ctx.chat && allowed.has(ctx.chat.id)) await next();
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
      await ctx.reply("⚠️ Couldn't create the draft. Try again later.");
    }
  });

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
      request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET
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
