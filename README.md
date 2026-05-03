# Caliptic

**The AI-native ITSM platform. Faster incidents. Smarter workflows. Agents that actually work.**

Caliptic is where AI agents and human teams manage IT services together — as equals. Built for modern teams of any size who are done duct-taping together legacy tools and bloated ticketing systems — from agile startups to enterprise IT departments.

Forget the old way. Caliptic brings AI agents into every corner of your service operations: they triage incidents the moment they're detected, route change requests through approval workflows automatically, respond to service requests without a queue, and surface recurring problems before they become outages — all in real time, right alongside your people.

**ITIL 4 compatible.** Caliptic natively supports Incident Management, Change Enablement, Service Request Management, and Problem Management — all enhanced with AI agents that can act, not just observe.

**Fully open source. Fully on-premise.** Run the entire stack — including AI agents — on your own hardware with zero cloud dependency.

This repository hosts **pre-built release assets** (installers, binaries) for the Caliptic desktop app and CLI. The main codebase is at [github.com/caliptic-org/caliptic](https://github.com/caliptic-org/caliptic).

---

## Why Caliptic?

- **Agents as first-class teammates** — assign issues to AI agents just like you would a human. They comment, update status, create follow-ups, and close tickets autonomously.
- **Real-time, every time** — live WebSocket-powered updates mean your team and your agents are always in sync. No refreshing, no polling, no lag.
- **ITIL 4 workflows, minus the paperwork** — run enterprise-grade service management without enterprise-grade overhead. Incident, change, problem, and service request workflows are built in.
- **Three operational layers** — Execution Core (agent task lifecycle, skills, runtimes, autopilot), Team Coordination (inbox, chat, approvals, activity timeline), and Operational Intelligence (SLA tracking, problem management, analytics, change control).
- **Skill library** — every solution your agents produce becomes a reusable skill for the whole team. Knowledge compounds over time.
- **Supervisor orchestration** — supervisor agents create and monitor child tasks delegated to worker agents with full context passing.
- **Local or cloud agents** — run agents as a local daemon for development or connect cloud runtimes for production. One dashboard for everything.
- **Ollama-powered private AI** — run Llama 3, Mistral, Gemma, and other open models locally. AI agents that never touch external APIs — your models, your hardware, your rules.
- **Self-host anywhere** — Docker Compose, single binary, or Kubernetes on-prem. Your issues, agent runs, and task history never leave your network.
- **No vendor lock-in** — bring your own LLM provider, swap agent backends, extend the API. Integrates with ServiceNow, ServiceCore, and existing ITSM toolchains.
- **Scales with your team** — whether you're a startup or an enterprise, Caliptic is lean, opinionated, and fast. No bloat, no seat-count surprises.

---

## Compliance & Security

| Standard | Status |
|----------|--------|
| ITIL 4 | Compatible |
| ISO 27001 | Ready |
| SOC 2 | Ready |
| Air-gapped deployment | Supported |
| Apache 2.0 | Open Source |

Built-in audit trail, access controls, and traceable execution history support ITIL 4 and ISO 27001 information security requirements out of the box.

---

## Download

### Latest Release

👉 [View Latest Release](https://github.com/caliptic-org/releases/releases/latest)

### Desktop App

| Platform | Installer | Portable |
|----------|-----------|----------|
| Windows x64 | [.exe](https://github.com/caliptic-org/releases/releases/latest/download/caliptic-desktop-windows-x64.exe) | — |
| macOS Apple Silicon (arm64) | [.dmg](https://github.com/caliptic-org/releases/releases/latest/download/caliptic-desktop-mac-arm64.dmg) | [.zip](https://github.com/caliptic-org/releases/releases/latest/download/caliptic-desktop-mac-arm64.zip) |
| macOS Intel (x64) | [.dmg](https://github.com/caliptic-org/releases/releases/latest/download/caliptic-desktop-mac-x64.dmg) | [.zip](https://github.com/caliptic-org/releases/releases/latest/download/caliptic-desktop-mac-x64.zip) |

> **macOS note:** If macOS blocks the app on first launch, right-click the `.dmg` and choose **Open** to bypass Gatekeeper.

### CLI

Install the `caliptic` CLI via [Homebrew](https://brew.sh):

```sh
brew install caliptic-org/tap/caliptic
```

Or download a binary directly from the [Releases page](https://github.com/caliptic-org/releases/releases/latest) for your platform (Linux, macOS, Windows).

---

## Getting Started

### Desktop App

1. Download the installer for your platform from the table above.
2. Install and launch Caliptic.
3. Sign in or create an account.
4. Create a workspace and invite your team — and your agents.

### CLI & Daemon

The `caliptic` CLI manages local agent daemons and lets you interact with your workspace from the terminal.

```sh
# Authenticate the CLI with your account
caliptic auth login

# View your current configuration
caliptic config

# Start the local agent daemon
caliptic daemon start

# Check daemon status
caliptic daemon status
```

For full CLI documentation, run `caliptic --help` or visit [caliptic.com/docs](https://caliptic.com/docs).

---

## Auto-Updates

The desktop app checks for updates automatically on launch. When a new version is available, you'll be prompted to install it. No manual re-downloading required.

---

## Release Notes

Full changelogs are available on the [Releases page](https://github.com/caliptic-org/releases/releases).

---

## Source Code

Caliptic is a **commercial product**. The source code is proprietary and not publicly available. This repository exists solely to distribute pre-built release artifacts.

For licensing inquiries, contact [info@caliptic.com](mailto:info@caliptic.com).

---

## Support

Have a question or found a bug?

- **Website:** [caliptic.com](https://caliptic.com)
- **Email:** [info@caliptic.com](mailto:info@caliptic.com)
- **GitHub:** [github.com/caliptic-org/caliptic](https://github.com/caliptic-org/caliptic)

---

<p align="center"><sub>© Caliptic. All rights reserved.</sub></p>
