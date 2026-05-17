# Hackathon Live Demo

This folder contains the exact lightweight prototype used for the ngrok demo:

- Bun backend serving the mobile UI
- Matrix bridge to the local Synapse room
- OpenClaw launcher/config script
- UI-only phone shell that renders complete A2UI packets and hides plain chat text

Run from this directory:

```bash
cd examples/hackathon-live-demo/backend
bun run demo:gbrain-openclaw
```

Then expose it:

```bash
ngrok http --url=jitsw.ngrok.io 80
```

Open:

```text
https://jitsw.ngrok.io/?v=demo
```

Watch the OpenClaw Matrix session:

```bash
openclaw tui --agent main --session 'matrix:direct:@jitsw-human:localhost'
```

The backend intentionally wraps every chat-button submission with a compact A2UI-only instruction, and it reconstructs split OpenClaw JSON fragments before the UI sees them. That keeps the phone interface focused on generated UI rather than streaming text.
