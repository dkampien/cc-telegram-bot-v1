# CC Telegram Bot — Architecture Overview

## What We Built (v1) — SDK Approach

Standalone bot that runs its own Claude Code sessions via the Agent SDK.

```
Your phone (Telegram)  ←→  Bot process (Node.js)  ←→  Claude Code SDK
Your terminal (stdin)   ←→       ↑ same process         (separate sessions)
```

- Spawns **its own** Claude Code sessions — completely separate from any running terminal
- Terminal input in the bot is just another way to talk to that same bot-managed session
- Not connected to your actual working Claude Code terminal

**What it is:** A second Claude Code accessible from your phone + a local prompt.

**What it isn't:** A bridge to your live terminal session.

**Stack:** Node.js, grammy (Telegram), @anthropic-ai/claude-agent-sdk

---

## What We Actually Want — Live Terminal Bridge

Bridge an **already-running** Claude Code terminal session to Telegram. See output in real time, send input back from your phone.

### CCBot (`six-ddc/ccbot`) — The Solution

Purpose-built Telegram ↔ tmux bridge for Claude Code. This is exactly the tool for the job.

- **GitHub:** `github.com/six-ddc/ccbot`
- **Architecture:** Thin layer over tmux. Each Telegram topic maps 1:1 to a tmux window running Claude Code.
- **How it works:**
  - `tmux send-keys` to inject keystrokes into the Claude Code pane
  - `tmux capture-pane` / `pipe-pane` to stream output to Telegram
  - `SessionStart` hook auto-tracks which session lives in which tmux window
- **Features:**
  - Real-time notifications (responses, thinking, tool use, command output)
  - Inline keyboards for permission prompts, plan approvals, multi-choice
  - Create/kill sessions from Telegram via directory browser
  - Paginated message history
- **Philosophy:** "The terminal stays the source of truth." No SDK, no separate API sessions.

```
Your terminal (tmux)  ←→  CCBot  ←→  Telegram
     ↑ actual Claude Code session        ↑ your phone
```

### Alternatives Considered

| Approach | Bridges live terminal? | Real-time? | Status |
|----------|----------------------|------------|--------|
| **CCBot** (tmux bridge) | Yes | Yes (pipe-pane) | Existing OSS project |
| **Claude Code Remote** (hooks + tmux) | Partially | No (task boundaries) | Existing OSS, 816+ stars |
| **CoderBOT** (node-pty) | New process only | Yes | Existing OSS |
| **Our v1** (SDK) | No | No (turn-based) | Built, working |

### Why tmux Is the Right Layer

- tmux is already designed for multiplexing terminal sessions
- `send-keys` = input injection, `pipe-pane` = output streaming
- Claude Code is unaware of the bridge — no modifications needed
- You can still attach/detach your real terminal at will
- The session stays the same whether you're at your desk or on your phone

---

## Reference

- Full research on approaches: `terminal-to-telegram-bridge.md`
- Hooks docs: Claude Code hooks are outbound-only (can notify, can block, cannot inject prompts)
- Our v1 source: `src/index.js`
