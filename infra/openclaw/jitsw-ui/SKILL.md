---
name: jitsw-ui
description: Respond via A2UI surfaces over Matrix instead of plain text. Use whenever the active Matrix room is tagged for JITSW (room state contains `com.jitsw.enabled: true`, or `JITSW_ROOMS` env names this room). Every reply must be an `m.room.message` with structured `com.jitsw.a2ui` content rendered by the JITSW mobile client. Use for human-agent interaction, approvals, generated UIs, alerts, status updates, and routing GBrain/GStack commands.
metadata:
  openclaw:
    emoji: "📱"
---

# JITSW UI

JITSW is the mobile A2UI client for OpenClaw + GBrain agents. The user is not at their Mac — they are on their phone. Every reply you send must be **renderable software**, not a paragraph of text.

You are the agent. JITSW is the screen. Build for the screen.

## When This Skill Applies

This skill applies whenever the active room is a JITSW room. A room is JITSW when **any** of the following are true:

1. The room state event `com.jitsw.room` contains `{ "enabled": true }`.
2. The room ID is listed in the `JITSW_ROOMS` environment variable.
3. The user explicitly invoked a JITSW command (see "Commands" below).

In a JITSW room, do not reply with plain text, markdown explanation, or status narration. Reply with an A2UI surface.

## The Core Contract

Every reply is a Matrix message of type `m.room.message` with the following shape:

```json5
{
  "msgtype": "m.notice",
  "body": "<short text fallback for stock Matrix clients>",
  "com.jitsw.a2ui": {
    "kind": "approval | alert | generated_ui | status | question",
    "title": "<short headline>",
    "summary": "<optional one-line summary>",
    "version": "v0.8",
    "messages": [
      { "surfaceUpdate": { "surfaceId": "main", "components": [ ... ] } },
      { "beginRendering": { "surfaceId": "main", "root": "<rootId>" } }
    ],
    "hints": { "riskLevel": "low | medium | high", "reversible": true }
  }
}
```

- `body` is only the **fallback** for Matrix clients that do not understand JITSW. JITSW ignores it. Keep it under 120 characters and never put the real answer there.
- `com.jitsw.a2ui.kind` controls how JITSW styles the card. Pick the most accurate kind; never default to `approval` if a `status` is more honest.
- `com.jitsw.a2ui.messages` is an array of [A2UI v0.8](https://a2ui.org) messages. The JITSW renderer passes them directly to `@a2ui/lit`.

## A2UI v0.8 Components You Can Use

Layout: `Column`, `Row`, `Card`, `List`, `Tabs`, `Modal`, `Divider`.
Display: `Text` (with `usageHint`: `h1`, `h2`, `h3`, `body`, `caption`), `Image`, `Icon`, `Video`, `AudioPlayer`.
Input: `TextField`, `CheckBox`, `MultipleChoice`, `Slider`, `DateTimeInput`, `Button`.

Buttons emit `a2uiaction` events. JITSW forwards them back to you as `com.jitsw.a2ui.action` events in the same Matrix room. Wait for and act on those actions.

## Picking the Right `kind`

| kind            | When                                                                  |
|-----------------|-----------------------------------------------------------------------|
| `approval`      | You need a yes/no/edit decision before continuing.                    |
| `alert`         | Something happened the user must know about (no action required).     |
| `generated_ui`  | You built an interactive UI for the user to explore or fill in.       |
| `status`        | Progress update on a long-running task.                               |
| `question`      | You need free-form input (a TextField) and cannot proceed without it. |

## Required Patterns

### Approval

Two buttons, plus a third "Request changes" only when the user can ask for edits. Always include the rationale and risk level.

```json5
{
  "kind": "approval",
  "title": "Approve deploy to production",
  "summary": "3 risky migrations, 1 reversible.",
  "version": "v0.8",
  "messages": [{
    "surfaceUpdate": {
      "surfaceId": "main",
      "components": [
        { "id": "root", "component": { "Column": { "children": { "explicitList": ["why", "buttons"] }}}},
        { "id": "why", "component": { "Text": { "text": { "literalString": "Why this is safe: ..." }, "usageHint": "body" }}},
        { "id": "buttons", "component": { "Row": { "children": { "explicitList": ["approve", "reject"] }}}},
        { "id": "approve", "component": { "Button": { "label": { "literalString": "Approve" }, "action": "approve" }}},
        { "id": "reject", "component": { "Button": { "label": { "literalString": "Reject" }, "action": "reject" }}}
      ]
    }
  },
  { "beginRendering": { "surfaceId": "main", "root": "root" }}],
  "hints": { "riskLevel": "high", "reversible": false }
}
```

### Citations from GBrain

When you used GBrain to produce a packet, include a `Card` at the bottom listing citations. Each citation is `<source>:<slug>` with a short excerpt. The JITSW client styles citations differently from body text.

## GBrain / GStack Command Routing

The JITSW client surfaces a fixed set of commands as taps. When the user picks one, JITSW sends you a Matrix message with `com.jitsw.command: { id, kind }` in its content. Map the `id` to a GBrain or GStack operation and reply with an A2UI surface that shows the result.

| Command id        | Resolves to             | Surface to return                                |
|-------------------|-------------------------|--------------------------------------------------|
| `ask`             | `gbrain.query`          | `generated_ui` with a TextField + results list   |
| `recall`          | `gbrain.recall`         | `generated_ui` with a List of recent memories    |
| `save-note`       | `gbrain.put_page`       | `question` with TextField for title + body       |
| `people`          | `gbrain.find_experts`   | `generated_ui` with a List of people             |
| `extract-facts`   | `gbrain.extract_facts`  | `status` while running, then `alert` with facts  |
| `ship`            | `gstack.ship`           | `approval` before pushing                        |
| `review`          | `gstack.review`         | `generated_ui` with a diff summary               |
| `investigate`     | `gstack.investigate`    | `generated_ui` with the evidence chain           |
| `office-hours`    | `gstack.office-hours`   | `generated_ui` with brainstorm scaffolding       |
| `new-agent`       | `gbrain.io/provision`   | `question` asking for the agent name/goal        |
| `agents`          | `openclaw.list`         | `generated_ui` with a List of running agents     |

If the user types text instead of using a command, infer intent and respond with an appropriate surface anyway. **Never** reply with raw text.

## Hard Rules

- Never send plain text in a JITSW room. If unsure what to render, return a complete `status` surface.
- Never send `m.text`; always use `m.notice` so stock Matrix clients don't double-notify.
- Never omit `body`. A stock Matrix client must still show something human-readable.
- Never invent A2UI components outside the v0.8 schema. The renderer will silently drop them.
- Never produce more than one A2UI message per Matrix event without good reason. One surface per packet keeps the feed scannable.
- When in doubt about which `kind` to use, pick `generated_ui`.

## Action Replies

When the user interacts with a surface, JITSW sends back an `m.room.message` with `com.jitsw.a2ui.action` content:

```json5
{
  "msgtype": "m.notice",
  "body": "Action: approve",
  "com.jitsw.a2ui.action": {
    "id": "<uuid>",
    "packetId": "<packet-id>",
    "name": "approve",
    "surfaceId": "main",
    "sourceComponentId": "approve",
    "context": { /* resolved A2UI data model */ }
  }
}
```

Use the action `name` to decide what to do next. Always confirm with a follow-up surface ("Approved. Deploying..." as a `status`, then "Deployed." as an `alert`).
