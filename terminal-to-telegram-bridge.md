# Bridging a Running Claude Code CLI to Telegram: Approaches and Tools

## The Problem

Claude Code runs as an interactive terminal application. If you walk away from your computer, the session keeps processing but you lose visibility and control. Most Telegram bots for LLM coding assistants spawn **isolated API sessions** that can't be resumed in your terminal. The goal is to bridge the **actual running interactive session** — sending input, capturing output, and relaying both through Telegram — without losing state or context.

## Open-Source Projects That Solve This Today

### CCBot / ccmux (six-ddc)

**The most direct solution.** CCBot is a Telegram ↔ tmux bridge specifically built for Claude Code. It was posted to Hacker News and r/ClaudeAI in early February 2026 and is the clearest example of exactly what you're describing.[^1][^2]

- **GitHub:** `github.com/six-ddc/ccbot`[^3]
- **Architecture:** Thin layer over tmux. Each Telegram topic maps 1:1 to a tmux window containing a Claude Code session.[^4]
- **How it works:**
  - Uses `tmux send-keys` to inject keystrokes into the Claude Code pane
  - Uses `tmux capture-pane` (and likely `pipe-pane`) to read Claude's output
  - A `SessionStart` hook auto-tracks which Claude session lives in which tmux window[^1]
- **Key features:**
  - Real-time notifications for responses, thinking, tool use, and command output
  - Interactive inline keyboards for permission prompts, plan approvals, and multi-choice questions
  - Create/kill sessions directly from Telegram via a directory browser
  - Paginated message history[^2]
- **Design philosophy:** "The terminal stays the source of truth." No SDK, no separate API sessions. CCBot was dogfooded — built using itself, with Claude Code sessions monitored and driven from Telegram.[^1]

### Claude Code Remote (JessyTsui)

A more general-purpose multi-platform remote control layer for Claude Code, supporting Email, Telegram, LINE, and desktop notifications.[^5][^6]

- **GitHub:** `github.com/JessyTsui/Claude-Code-Remote` — 816+ stars[^5]
- **Architecture:** Uses Claude Code's **hooks system** (`Stop` and `SubagentStop` hooks) to trigger notifications when Claude finishes a task. Commands are injected back into tmux via `tmux send-keys`.[^5]
- **Key mechanism:**
  - Hook scripts fire a Node.js notification script when Claude completes work
  - Telegram bot receives the notification, presents inline buttons with a session token
  - User replies with `/cmd TOKEN123 your command here`
  - The command is injected into the correct tmux session via `tmux send-keys`[^5]
- **Limitations:** This is **hook-driven** rather than continuous streaming — you get notified at task boundaries rather than real-time output. More of a "notification + command injection" model than a full bidirectional terminal mirror.

### CoderBOT (Tommertom)

A Telegram bot providing **full interactive terminal sessions** with PTY support, designed for any CLI-based AI tool (Copilot CLI, OpenCode, Gemini, Claude Code).[^7]

- **GitHub:** `github.com/Tommertom/coderBOT`
- **Architecture:** Uses **node-pty** to spawn a real pseudo-terminal, giving full xterm terminal access over Telegram.[^7]
- **Key features:**
  - Full PTY support — the process thinks it's talking to a real terminal
  - Voice coding via Whisper/Gemini transcription
  - Terminal screenshot functionality
  - Works on Linux/macOS; Windows via Docker[^7]
- **Trade-off:** This spawns a **new** PTY-wrapped process rather than attaching to an already-running one. You'd need to start Claude Code through CoderBOT rather than bridge an existing session.

***

## Core Architectural Approaches

### 1. tmux send-keys + capture-pane / pipe-pane (Recommended)

This is the dominant approach for bridging an already-running interactive CLI and is what CCBot and Claude Code Remote both use.

**Input (Telegram → Terminal):**
```bash
# Send a command to a specific tmux pane
tmux send-keys -t mysession:0.0 "your command here" Enter

# Send special keys
tmux send-keys -t mysession:0.0 Escape     # Send Esc
tmux send-keys -t mysession:0.0 C-c        # Send Ctrl+C
tmux send-keys -t mysession:0.0 C-o        # View real-time output
```
The `-t` flag targets a specific session:window.pane.[^8][^9]

**Output (Terminal → Telegram):**

Option A — Polling with `capture-pane`:
```bash
# Capture the visible pane content
tmux capture-pane -t mysession:0.0 -p

# Capture with scrollback history
tmux capture-pane -t mysession:0.0 -p -S -500
```
This captures a snapshot. You'd poll periodically and diff against the previous capture to detect new output.[^10]

Option B — Streaming with `pipe-pane`:
```bash
# Pipe all pane output to a file or process
tmux pipe-pane -t mysession:0.0 -o 'cat >> /tmp/claude_output.log'

# Or pipe to a FIFO that your bot reads from
tmux pipe-pane -t mysession:0.0 -o 'cat > /tmp/claude_fifo'

# Stop piping
tmux pipe-pane -t mysession:0.0
```
`pipe-pane` gives you a continuous output stream — every byte rendered in the pane goes to your command.[^11][^12]

**Pros:** No modification of Claude Code needed. The session is completely unaware of the bridge. You can attach/detach your real terminal at will.
**Cons:** Output is raw terminal data (includes ANSI escape codes, cursor movements). You need to strip or parse these for clean Telegram messages.

### 2. PTY Proxying (node-pty / Python pty)

Instead of using tmux as the intermediary, you can spawn the interactive process inside a PTY you control directly.

**Python approach using `os.forkpty`:**
```python
import os, select

pid, master_fd = os.forkpty()
if pid == 0:
    # Child: exec Claude Code
    os.execvp("claude", ["claude"])
else:
    # Parent: master_fd is connected to Claude's stdin/stdout/stderr
    # Read output:  os.read(master_fd, 4096)
    # Send input:   os.write(master_fd, b"your command\n")
```
The parent holds `master_fd` which is a file descriptor for both reading output and writing input to the child process.[^13][^14]

**Node.js approach using node-pty:**
```javascript
const pty = require('node-pty');
const proc = pty.spawn('claude', [], { name: 'xterm-256color' });
proc.onData(data => { /* send to Telegram */ });
proc.write('your command\r');  // inject input
```
This is what CoderBOT uses.[^15][^7]

**Pros:** Clean, programmatic access to both input and output streams. Full control over the PTY dimensions, environment, etc.
**Cons:** You must **start** the process through the proxy. You cannot attach to an **already-running** Claude Code session this way. This is the key limitation for your use case.

### 3. pexpect / expect Automation

Pexpect wraps the PTY approach in a higher-level API designed for pattern-matching on output and sending responses.[^16][^17]

```python
import pexpect

child = pexpect.spawn('claude')
child.expect('❯')  # Wait for Claude's prompt
child.sendline('fix the login bug')
child.expect('Do you want to proceed.*\\(y/n\\)')
child.sendline('y')
output = child.before  # Everything before the match
```

The library creates a pseudo-terminal and provides `expect()` (wait for pattern) and `sendline()` (inject input) — simulating human interaction.[^17][^18]

**Pros:** Excellent for structured interactions where you can predict prompts (permission requests, plan approvals).
**Cons:** Same limitation as raw PTY — you must spawn the process through pexpect, not attach to an existing one. Pattern matching on Claude Code output can be fragile if the UI changes.

### 4. Unix Named Pipes (FIFOs)

FIFOs provide unidirectional IPC channels via the filesystem. You'd use two FIFOs — one for input, one for output.[^19][^20]

```bash
mkfifo /tmp/claude_in /tmp/claude_out

# In theory, redirect Claude's stdin/stdout:
claude < /tmp/claude_in > /tmp/claude_out

# From your Telegram bot:
echo "fix the bug" > /tmp/claude_in
cat /tmp/claude_out  # read responses
```

**The problem:** Claude Code is a full TUI application that expects a real terminal (it reads from the TTY, not just stdin). Simple pipe redirection breaks interactive programs because they detect they're not connected to a terminal and change behavior or refuse to run.[^20]

**Workaround:** Combine FIFOs with a PTY wrapper — use `socat` or `script` to create a PTY that reads from a FIFO:
```bash
socat EXEC:"claude",pty,stderr PIPE:/tmp/claude_fifo
```

**Pros:** Simple IPC mechanism, no dependencies.
**Cons:** Doesn't work directly with interactive TUI apps. Requires PTY wrapping to be useful, at which point you're back to approach #2.

### 5. socat PTY Bridging

socat can create bidirectional byte streams between virtually anything — including PTYs, TCP sockets, and UNIX domain sockets.[^21][^22]

```bash
# Create a PTY pair — one for Claude, one for your bot
socat -d -d PTY,raw,echo=0,link=/tmp/claude_pty PTY,raw,echo=0,link=/tmp/bot_pty

# Start Claude on one end
claude < /tmp/claude_pty > /tmp/claude_pty

# Your bot reads/writes /tmp/bot_pty
```

Or bridge a PTY to a TCP socket for remote access:
```bash
socat PTY,raw,echo=0,link=/tmp/claude_pty TCP-LISTEN:9999,reuseaddr
```

**Pros:** Extremely flexible. Can bridge across network boundaries.
**Cons:** Complex setup. Same fundamental issue — you need to start Claude through the socat bridge, not attach to an existing process.

### 6. The `script` Command + Tail

The Unix `script` command records everything in a terminal session to a file.[^23][^24]

```bash
# Start Claude inside a script session
script -q /tmp/claude_session.log -c "claude"

# In another process, tail the log
tail -f /tmp/claude_session.log | your_telegram_bot_parser
```

For input injection, combine with tmux or a FIFO. This approach is simple for **output capture** but doesn't solve **input injection** on its own.

***

## Other Relevant Tools

| Tool | Type | Use Case |
|------|------|----------|
| **shell2telegram** [^25] | Go binary | Maps shell commands to Telegram bot commands. Stateless — each message runs a new command, not interactive |
| **ShellRemoteBot** [^26] | FreePascal | Terminal emulation over Telegram with file manager. Emulates sh/cmd sessions |
| **Terminal_bot** [^27] | Python | Simple remote command execution via Telegram. Cannot handle interactive processes (no sudo, no sub-shells) |
| **ttyd** [^28] | C binary | Shares terminal over web via WebSocket. Could be combined with a Telegram bot that interacts with the web interface |
| **GoTTY** [^29] | Go binary | Similar to ttyd — turns CLI tools into web applications. Read-only by default, `-w` flag enables writing |

***

## Recommended Architecture for Your Use Case

Given that you want to bridge an **already-running** Claude Code terminal session:

**Best approach: tmux + Telegram bot (the CCBot pattern)**

1. **Run Claude Code inside tmux** (you probably already do this)
2. **Use `pipe-pane`** to stream output to a process/FIFO that your Telegram bot reads
3. **Use `send-keys`** to inject commands from Telegram into the tmux pane
4. **Use Claude Code hooks** (`SessionStart`, `Stop`) to get structured notifications about session state
5. **Parse ANSI escape codes** from the raw terminal output using a library like `strip-ansi` (JS) or `pyte` (Python terminal emulator) to produce clean text for Telegram

The critical insight from the CCBot and Claude Code Remote projects is that **tmux is the universal interposition layer** — it's already designed to multiplex terminal sessions and provides built-in commands for both input injection and output capture. No need to reinvent that.[^2][^1]

If you want to build it yourself rather than using an existing project, the minimal viable bridge is roughly:

```python
# Pseudocode for a minimal tmux-Telegram bridge
import subprocess
from telegram.ext import Application, MessageHandler

SESSION = "claude"

def send_to_claude(text):
    subprocess.run(["tmux", "send-keys", "-t", SESSION, text, "Enter"])

def get_claude_output():
    result = subprocess.run(
        ["tmux", "capture-pane", "-t", SESSION, "-p", "-S", "-50"],
        capture_output=True, text=True
    )
    return result.stdout

async def handle_message(update, context):
    send_to_claude(update.message.text)
    # Wait and capture
    await asyncio.sleep(2)
    output = get_claude_output()
    await update.message.reply_text(output[-4000:])  # Telegram message limit
```

For production use, you'd replace the polling with `pipe-pane` streaming, add ANSI stripping, handle Claude's interactive prompts with inline keyboards, and implement proper session management — which is essentially what CCBot already does.[^3]

---

## References

1. [I built a Telegram bot to remote-control Claude Code ...](https://www.reddit.com/r/ClaudeAI/comments/1qydyb4/i_built_a_telegram_bot_to_remotecontrol_claude/) - CCBot connects Telegram to your tmux session — it reads Claude's output and sends keystrokes back. T...

2. [CCBot – Control Claude Code from Telegram via tmux](https://news.ycombinator.com/item?id=46923706) - I built a Telegram bot that lets you monitor and interact with Claude Code sessions running in tmux ...

3. [six-ddc/ccbot: Telegram ↔ tmux bridge for Claude Code](https://github.com/six-ddc/ccbot) - Control Claude Code sessions remotely via Telegram — monitor, interact, and manage AI coding session...

4. [I built a Telegram bot to remote-control Claude Code sessions via tmux - switch between terminal and phone seamlessly](https://www.reddit.com/r/VibeCodersNest/comments/1qyftk3/i_built_a_telegram_bot_to_remotecontrol_claude/) - I built a Telegram bot to remote-control Claude Code sessions via tmux - switch between terminal and...

5. [GitHub - yifanxz/claude-code-remote: Control Claude Code ...](https://github.com/yifanxz/claude-code-remote) - Control Claude Code remotely via email、discord、telegram. Start tasks locally, receive notifications ...

6. [JessyTsui/Claude-Code-Remote](https://github.com/JessyTsui/Claude-Code-Remote) - Control Claude Code remotely via multiple messaging platforms. Start tasks locally, receive notifica...

7. [Tommertom/coderBOT](https://github.com/Tommertom/coderBOT) - A Telegram bot that provides interactive terminal sessions with support for AI coding assistants (Gi...

8. [How to use tmux send-keys command?](https://tmuxai.dev/tmux-send-keys/) - The `send-keys` command programmatically sends keystrokes to a target pane. From the command line, u...

9. [A list of special control sequences you can send to tmux via the send-keys command.](https://gist.github.com/stephancasas/1c82b66be1ea664c2a8f18019a436938) - A list of special control sequences you can send to tmux via the send-keys command. - tmux-send-keys...

10. [How to capture pane content in tmux?](https://tmuxai.dev/tmux-capture-pane/) - Press Prefix `:`, then type `capture-pane -pS -` to print the entire scrollback history of the curre...

11. [How to pipe pane output to external commands?](https://tmuxai.dev/tmux-pipe-pane/) - Use `pipe-pane` to send pane output to external commands. Example: `pipe-pane -o 'cat >> ~/session.l...

12. [tmux: run command in pane and capture result, in bash script](https://stackoverflow.com/questions/58936269/tmux-run-command-in-pane-and-capture-result-in-bash-script) - Using tmux, I'd like to run a command from one pane against another pane, and capture the output of ...

13. [Python os.forkpty Function - Complete Guide](https://www.zetcode.com/python/os-forkpty/) - Complete guide to Python's os.forkpty function covering pseudo-terminal creation, process forking, a...

14. [36.9. pty — Pseudo-terminal utilities](https://documentation.help/Python-2.7.13/pty.html)

15. [How to combine node-pty and xterm](https://stackoverflow.com/questions/66058499/how-to-combine-node-pty-and-xterm) - I added a terminal to my web application using node-pty on the server, ng-termianl (xterm.js) on the...

16. [PEXPECT: CLI automation in Python - pythonlib](https://pythonlib.ru/en/library-theme75) - Study PEXPECT for automation of interactive command lines in Python. Manage processes, SSH, FTP, log...

17. [API Overview¶](https://pexpect.readthedocs.io/en/stable/overview.html)

18. [Core pexpect components - Read the Docs](https://pexpect.readthedocs.io/en/stable/api/pexpect.html) - Pexpect is a Python module for spawning child applications and controlling them automatically. Pexpe...

19. [Named pipe - Wikipedia](https://en.wikipedia.org/wiki/Named_pipe)

20. [Back to basics: FIFOs (Named Pipes) and simple IPC logging](https://offlinemark.com/fifos-and-simple-ipc-logging/) - FIFOS ("First-in-first-out"s aka Named Pipes) are are somewhat obscure part of Unix based operating ...

21. [Mastering Socat: Unlocking the Power of Bidirectional Data ...](https://hoop.dev/blog/mastering-socat-unlocking-the-power-of-bidirectional-data-streams/) - Socat is a command-line utility that creates bidirectional data streams between two endpoints. It is...

22. [Examples Top](https://man7.org/linux/man-pages/man1/socat.1.html)

23. [Using the script command to record a terminal session](https://rderik.com/blog/using-the-script-command-to-record-a-terminal-session/) - When working on the command-line, I sometimes would like to record what I was doing to extract the e...

24. [How to Record and Replay Linux Terminal Sessions](https://www.tecmint.com/record-and-replay-linux-terminal-session-commands-using-script/) - In this guide, we are going to look at how to use a script and scriptreplay commands in Linux that c...

25. [GitHub - msoap/shell2telegram: Telegram bot constructor from command-line](https://github.com/msoap/shell2telegram) - Telegram bot constructor from command-line. Contribute to msoap/shell2telegram development by creati...

26. [Al-Muhandis/ShellRemoteBot: Shell remote control from ...](https://github.com/Al-Muhandis/ShellRemoteBot) - Helps you work with your server (or remote computer) via telegram bot emulating terminal operations ...

27. [GitHub - RodrigoDePool/Terminal_bot: A python script to remotely control a terminal in a linux pc from Telegram](https://github.com/RodrigoDePool/Terminal_bot) - A python script to remotely control a terminal in a linux pc from Telegram - RodrigoDePool/Terminal_...

28. [ttyd - Efficiency Improvement Hard? ttyd for Quick Solution](https://www.x-cmd.com/install/ttyd/) - ttyd is a simple command-line tool for sharing terminal over the web. Install via X-CMD for instant ...

29. [yudai/gotty: Share your terminal as a web application](https://github.com/yudai/gotty) - GoTTY is a simple command line tool that turns your CLI tools into web applications. Screenshot. Ins...

