# AI Collaboration Notes

## Stretch Goal Implementation: LLM Integration

To tackle the AI stretch goal, I integrated the `@google/generative-ai` SDK. When a `pull_request` event is triggered, the bot passes the PR title and body to the `gemini-1.5-flash` model with a prompt to summarize the code change in a single sentence. This summary is then dynamically injected into the outgoing Slack notification webhook, successfully bridging GitHub event payloads with live AI processing.

## The Single Hardest Bug

The most difficult technical hurdle was a persistent `TypeError [ERR_INVALID_ARG_TYPE]` crash on the webhook receiving endpoint. When GitHub delivered a payload, the application would crash during the cryptographic signature verification step (`crypto.createHmac`) because the incoming `data` argument was `undefined`.

## Diagnosis & Resolution

Through debugging, I discovered that Express's global middleware parsers (specifically `express.json()` and `express.urlencoded()`) were destructively consuming the incoming HTTP request stream before it ever reached the signature verification logic. Because the stream was already read, `req.body` became undefined for the raw buffer check.

**The Fix:** I completely removed the global Express parsers. I isolated the standard JSON/URL parsing exclusively to the `/auth` routes using an `authRouter`. For the `/webhook` endpoint, I bypassed all standard parsers and used `express.raw({ type: '*/*' })` exclusively. This forced Express to preserve the raw byte buffer from GitHub regardless of the content-type, ensuring the payload could be perfectly hashed and verified against the `x-hub-signature-256` header.

## Note on AI Context Files:

I utilized a conversational AI assistant via a web interface for this project rather than an integrated IDE agent (like Cursor or Windsurf). Therefore, there are no .cursorrules or custom agent instruction files included in this repository.
