# CC Telegram Bot — Setup Guide

A Telegram bot that runs Claude Code sessions via the Agent SDK. Talk to Claude Code from your phone or from the terminal where the bot runs.

## Prerequisites

- **Node.js** v18+
- **Claude Code CLI** installed and authenticated
- **Telegram** account

## 1. Clone and install

```bash
git clone https://github.com/dkampien/cc-telegram-bot-v1.git
cd cc-telegram-bot-v1
npm install
```

## 2. Create a Telegram bot

1. Open Telegram, search for **@BotFather**
2. Send `/newbot`, follow the prompts
3. Copy the **bot token** (looks like `123456:ABC-DEF...`)

## 3. Get your Telegram user ID

1. Open the chat with your new bot (tap the `t.me/yourbot` link from BotFather)
2. Tap **Start**, then send any message (e.g. `hello`)
3. Open a browser and go to: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
4. Find `"chat":{"id":123456789}` — that number is your user ID

## 4. Configure

```bash
cp .env.example .env
```

Edit `.env`:

```ini
TELEGRAM_BOT_TOKEN=your_bot_token
ALLOWED_USER_ID=your_user_id
CLAUDE_CWD=/path/to/your/project
CLAUDE_MODEL=claude-sonnet-4-6
```

`CLAUDE_CWD` is the directory Claude Code will work in (read files, edit, run commands).

## 5. Run

```bash
npm start
```

**Important:** Run this in a standalone terminal, **not** inside a Claude Code session. The SDK cannot spawn inside another Claude Code process.

## 6. Use it

**From Telegram** — send any message to your bot. Claude responds in the chat.

**From the terminal** — type at the `>` prompt. Claude responds in the terminal.

Both share the same session. A conversation started on your phone continues in the terminal and vice versa.

### Commands (work in both Telegram and terminal)

| Command | What it does |
|---------|-------------|
| `/new` | Start a fresh session (clears conversation) |
| `/session` | Show current session ID |
| `/cwd` | Show working directory |
| `/help` | Show available commands (terminal only) |

## Notes

- **Session persistence:** Sessions live in memory. If you restart the bot, the session resets. The conversation data is still saved by Claude Code at `~/.claude/projects/` and can be resumed manually.
- **Cost:** Each message is an API call. Simple messages ~$0.01-0.03, complex multi-tool responses can be $0.05-0.50+.
- **Telegram message limit:** Responses longer than 4000 characters are automatically split into multiple messages.
- **Auth:** Only the `ALLOWED_USER_ID` can talk to the bot. Everyone else gets "Unauthorized."
