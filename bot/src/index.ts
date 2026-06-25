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
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "untitled"
  );
}

/** UTF-8 safe base64 (btoa alone mangles multi-byte chars). */
function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function draftMarkdown(title: string, body: string): string {
  const safeTitle = title.replace(/"/g, '\\"');
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

/** Commit a draft markdown file via the GitHub Contents API. */
async function createDraft(env: Env, title: string, body: string): Promise<string> {
  const path = `${env.CONTENT_DIR}/${slugify(title)}.md`;
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
        content: utf8ToBase64(draftMarkdown(title, body)),
        branch: env.GITHUB_BRANCH,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`GitHub ${res.status}: ${await res.text()}`);
  }
  return path;
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
    return webhookCallback(buildBot(env), "cloudflare-mod")(request);
  },
};
