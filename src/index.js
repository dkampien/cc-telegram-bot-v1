import "dotenv/config";
import { createInterface } from "readline";
import { Bot } from "grammy";
import { query } from "@anthropic-ai/claude-agent-sdk";

// --- Config ---
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_USER_ID = Number(process.env.ALLOWED_USER_ID);
const CLAUDE_CWD = process.env.CLAUDE_CWD || process.cwd();
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

if (!BOT_TOKEN) {
  console.error("Missing TELEGRAM_BOT_TOKEN in .env");
  process.exit(1);
}

// --- State ---
let sessionId = null;
let busy = false;

// --- Shared query runner ---
async function runQuery(userMessage, onResponse) {
  if (busy) {
    await onResponse("Still working on the previous message. Please wait.");
    return;
  }

  busy = true;

  try {
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const options = {
      model: CLAUDE_MODEL,
      cwd: CLAUDE_CWD,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      settingSources: ["project"],
      maxTurns: 20,
      env,
      stderr: (data) => console.error("[claude stderr]", data),
    };

    if (sessionId) {
      options.resume = sessionId;
    }

    let resultText = "";
    let cost = 0;
    let turns = 0;

    for await (const message of query({ prompt: userMessage, options })) {
      if (message.type === "system" && message.subtype === "init") {
        sessionId = message.session_id;
      }

      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if (block.type === "text") {
            resultText += block.text + "\n";
          }
        }
      }

      if (message.type === "result") {
        cost = message.total_cost_usd || 0;
        turns = message.num_turns || 0;
        if (message.subtype === "success" && message.result) {
          resultText = message.result;
        }
      }
    }

    if (!resultText.trim()) {
      resultText = "(No response from Claude)";
    }

    const footer = `\n---\n$${cost.toFixed(4)} | ${turns} turns`;
    await onResponse(resultText + footer);
  } catch (err) {
    console.error("Query error:", err);
    await onResponse(`Error: ${err.message}`);
  } finally {
    busy = false;
  }
}

// --- Telegram Bot ---
const bot = new Bot(BOT_TOKEN);

bot.use(async (ctx, next) => {
  if (ctx.from?.id !== ALLOWED_USER_ID) {
    await ctx.reply("Unauthorized.");
    return;
  }
  return next();
});

bot.command("start", async (ctx) => {
  await ctx.reply(
    "Claude Code bridge active.\n\n" +
      `/new — Start fresh session\n` +
      `/session — Show current session ID\n` +
      `/cwd — Show working directory\n\n` +
      `Send any message to talk to Claude Code.`
  );
});

bot.command("new", async (ctx) => {
  sessionId = null;
  await ctx.reply("Session cleared. Next message starts a fresh conversation.");
});

bot.command("session", async (ctx) => {
  await ctx.reply(sessionId ? `Session: ${sessionId}` : "No active session.");
});

bot.command("cwd", async (ctx) => {
  await ctx.reply(`Working directory: ${CLAUDE_CWD}`);
});

bot.on("message:text", async (ctx) => {
  console.log(`\n[telegram] ${ctx.from.first_name}: ${ctx.message.text}`);

  const typingInterval = setInterval(async () => {
    try { await ctx.replyWithChatAction("typing"); } catch {}
  }, 4000);

  await ctx.replyWithChatAction("typing");

  await runQuery(ctx.message.text, async (text) => {
    clearInterval(typingInterval);
    console.log(`[telegram] Claude: ${text.split("\n")[0]}...`);
    await sendChunked(ctx, text);
  });
});

async function sendChunked(ctx, text, maxLen = 4000) {
  const chunks = [];
  let current = "";

  for (const line of text.split("\n")) {
    if ((current + "\n" + line).length > maxLen) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = current ? current + "\n" + line : line;
    }
  }
  if (current) chunks.push(current);

  for (const chunk of chunks) {
    await ctx.reply(chunk);
  }
}

// --- Terminal Interface ---
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "\n> ",
});

function handleTerminalCommand(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;

  if (trimmed === "/new") {
    sessionId = null;
    console.log("Session cleared.");
    return true;
  }
  if (trimmed === "/session") {
    console.log(sessionId ? `Session: ${sessionId}` : "No active session.");
    return true;
  }
  if (trimmed === "/cwd") {
    console.log(`Working directory: ${CLAUDE_CWD}`);
    return true;
  }
  if (trimmed === "/help") {
    console.log("/new     — Start fresh session");
    console.log("/session — Show current session ID");
    console.log("/cwd     — Show working directory");
    console.log("/help    — Show this help");
    return true;
  }
  return false;
}

rl.on("line", async (line) => {
  if (!line.trim()) {
    rl.prompt();
    return;
  }

  if (handleTerminalCommand(line)) {
    rl.prompt();
    return;
  }

  await runQuery(line.trim(), async (text) => {
    console.log("\n" + text);
  });

  rl.prompt();
});

// --- Start ---
console.log(`Claude Code Telegram Bridge`);
console.log(`  CWD: ${CLAUDE_CWD}`);
console.log(`  Model: ${CLAUDE_MODEL}`);
console.log(`  Allowed user: ${ALLOWED_USER_ID}`);
console.log(`  Type /help for commands\n`);

bot.start();
rl.prompt();
