# Siri-Gemini Action Simulator

> A WWDC26 concept prototype: current page context, Gemini planning, safe preview, and user-approved browser actions.

<div align="center">

[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest_V3-0A84FF?style=for-the-badge&logo=google-chrome&logoColor=white)](https://developer.chrome.com/docs/extensions/)
[![Gemini AI](https://img.shields.io/badge/Gemini-Action_Planning-D4AF37?style=for-the-badge&logo=google-gemini&logoColor=white)](https://ai.google.dev/)
[![WWDC26](https://img.shields.io/badge/WWDC26-Siri_Actions-30D158?style=for-the-badge&logo=apple&logoColor=white)](https://developer.apple.com/wwdc26/)
[![Streak](https://img.shields.io/badge/Day-15_Pivot-vanilla?style=for-the-badge&logo=x&logoColor=white)](https://x.com/happy_ships)

</div>

---

## The Bet

WWDC26 is the perfect moment to ask one question:

**What does Siri become if Gemini gives it strong reasoning, but Apple owns the trust layer?**

Chat is not the hard part. The hard part is safe action:

1. Read what is on screen.
2. Understand the user's intent.
3. Plan what could be done.
4. Preview the action.
5. Wait for approval before touching anything.

This extension demonstrates that pattern inside Chrome.

> This is an independent concept prototype. It is not affiliated with Apple, Siri, Google, or Gemini. It does not integrate with real Siri.

---

## What It Does

Open any webpage, then ask the extension to do something like:

- "Decode this job post and draft a WWDC reply about what Siri should understand."
- "Analyze this page for dark patterns and highlight suspicious parts."
- "Draft a helpful response in this form, but do not submit it."
- "Explain what app actions Apple would need to expose for Siri to do this safely."

Gemini returns a structured plan. The extension then:

- shows the plan in the popup
- previews highlights/fills on the page
- blocks unsafe actions like click, submit, delete, buy, navigate, download, or send
- applies only safe actions after the user clicks approve

---

## Safety Model

The extension is built around the roadblocks that make real assistant actions hard:

| Roadblock | Fix in this prototype |
| --- | --- |
| AI invents selectors | The content script assigns page element IDs first. Gemini can only use IDs from that collected map. |
| AI clicks the wrong button | Click, submit, purchase, delete, navigation, download, and send actions are blocked. |
| User loses control | Every plan is previewed. Nothing applies until the user approves. |
| Private page context leaks silently | The popup states it reads only the current tab. API keys are stored locally in Chrome storage. |
| Forms are risky | Fill actions are allowed only for detected fillable fields. Submitting is always manual. |

This is the trust layer the demo is about.

---

## Core Features

- **Siri-like action command** - type a natural language request about the current page.
- **Page context extraction** - title, URL, selected text, visible page text, and visible actionable elements.
- **Gemini structured planning** - returns strict JSON with summary, draft, actions, and safety notes.
- **Preview overlay** - highlights planned targets directly on the page before applying.
- **Approval-only execution** - safe fill/highlight actions run only after user approval.
- **Copyable WWDC drafts** - generated replies/summaries can be copied without touching the page.
- **Gemini + OpenRouter fallback** - direct Gemini first, fallback key optional.

---

## Getting Started

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `siri-gemini-action-sim` folder.
5. Open the extension popup.
6. Add a Gemini API key from AI Studio, or an OpenRouter fallback key.
7. Open a normal webpage and run a command.

Chrome blocks extensions on pages like `chrome://extensions`, so test on a regular website or local HTML page.

---

## Demo Script

### Demo 1: WWDC Reply Writer

1. Open a WWDC/Siri/Gemini article.
2. Run: "Read this page like Siri with Gemini underneath. Summarize what matters and draft a concise X reply about the WWDC angle."
3. Show the preview panel.
4. Copy the reply.

### Demo 2: Safe Form Fill

1. Open a page with a text area.
2. Run: "Draft a helpful response in this text box. Do not submit anything."
3. Show the fill preview.
4. Apply safe actions.
5. Point out that no send/submit click happened.

### Demo 3: Dark Pattern Scan

1. Open a pricing or signup page.
2. Run: "Analyze this page for dark patterns and hidden costs."
3. Show highlighted suspicious UI.

---

## Technical Stack

- **Extension framework**: Chrome Manifest V3
- **AI planning**: Gemini API via `gemini.js`
- **Fallback**: OpenRouter model cascade
- **Runtime**: Vanilla JavaScript, no build step
- **Page bridge**: Content script with element ID mapping
- **Execution policy**: allowlist-only `highlight`, `fill`, and `copy`

---

## Engineering Highlight: IDs Before AI

The key design decision is simple: Gemini never sees the DOM as something it can freely query.

The content script first creates a controlled map:

```json
{
  "id": "sgas-42",
  "tag": "textarea",
  "fillable": true,
  "label": "Reply",
  "placeholder": "Write your response"
}
```

Gemini must choose from those IDs. If it references an unknown ID, the popup drops that action. If it tries to fill a non-fillable element, that action is dropped. If it proposes click/submit/send, the action is blocked.

That turns an agent demo from "hope the model is careful" into a small, inspectable safety system.

---

## WWDC26 Angle

Apple's 2026 developer story is expected to be judged heavily on Siri, Apple Intelligence, app actions, and trust. This prototype is built as a browser-native thought experiment:

> If Siri gets stronger model reasoning, the winning UX still has to be preview-first and approval-first.

That is the point of the extension.

---

## 180 Days of Building

This is a strategic Day 15 pivot from the original `thinking-level-optimizer` slot into a more WWDC-native build.

Follow along:

- X/Twitter: [@happy_ships](https://x.com/happy_ships)
- Hashtags: `#WWDC26`, `#Siri`, `#Gemini`, `#BuildInPublic`

---

*MIT-style project. Independent concept prototype.*
