# Workspace Chat

This document describes the Workspace Chat tab, WebSocket protocol, and block schema for interactive chat components.

## HTTP Endpoints

Base path: `/api/research-jobs/:id/chat`.

- `GET /sessions`
  - List sessions for a research job, most recent first.
- `POST /sessions`
  - Create a new session. Body: `{ "title"?: string }`.
- `GET /sessions/:sessionId`
  - Fetch session metadata + messages.
- `POST /sessions/:sessionId/messages`
  - Fallback HTTP path to create a user message and generate a reply.
  - Body: `{ "content": string }`.
- `POST /sessions/:sessionId/events`
  - Record a block event. Body: `{ "messageId": string, "blockId": string, "eventType": "VIEW"|"PIN"|"UNPIN"|"SELECT_DESIGN", "payload"?: object }`.
- `GET /sessions/:sessionId/saved-blocks`
  - List pinned blocks.

Errors follow `{ "error": string, "details"?: string }`.

## WebSocket

Path: `/api/ws/research-jobs/:id/chat`.

### Client → Server

- `AUTH`
  - `{ type: "AUTH", researchJobId, sessionId? }`
- `USER_MESSAGE`
  - `{ type: "USER_MESSAGE", sessionId, content, clientMessageId? }`
- `BLOCK_EVENT`
  - `{ type: "BLOCK_EVENT", sessionId, messageId, blockId, eventType, payload? }`
- `SELECT_DESIGN`
  - `{ type: "SELECT_DESIGN", sessionId, messageId, designId }`

### Server → Client

- `AUTH_OK`
  - `{ type: "AUTH_OK", sessionId }`
- `HISTORY`
  - `{ type: "HISTORY", sessionId, messages: [...] }`
- `ASSISTANT_START`
  - `{ type: "ASSISTANT_START", messageId, clientMessageId? }`
- `ASSISTANT_DELTA`
  - `{ type: "ASSISTANT_DELTA", messageId, delta }`
- `ASSISTANT_BLOCKS`
  - `{ type: "ASSISTANT_BLOCKS", messageId, blocks, designOptions? }`
- `ASSISTANT_DONE`
  - `{ type: "ASSISTANT_DONE", messageId }`
- `ERROR`
  - `{ type: "ERROR", error, details? }`

## Block Schema

Each assistant message can include structured blocks. Blocks are delivered in `ASSISTANT_BLOCKS` and persisted in `chat_messages.blocks`.

Common fields:

- `type`: string
- `blockId`: stable unique identifier for the block within the message
- `title`: optional short label

Supported block types:

- `table`
  - `{ type: "table", blockId, title?, caption?, columns: string[], rows: object[] }`
- `metric_cards`
  - `{ type: "metric_cards", blockId, title?, cards: [{ label, value, change?, description? }] }`
- `insight`
  - `{ type: "insight", blockId, title, body, severity? }`
- `post_grid`
  - `{ type: "post_grid", blockId, title?, postIds: string[] }`
- `comparison`
  - `{ type: "comparison", blockId, title?, left: { title?, items[] }, right: { title?, items[] } }`
- `source_list`
  - `{ type: "source_list", blockId, sources: [{ handle, note? }] }`

## Design Options

Assistant replies can include multiple designs:

```
{
  "designOptions": [
    { "designId": "design-a", "label": "Design A", "blocks": [ ... ] }
  ]
}
```

The UI lets users switch designs and records `SELECT_DESIGN` events.

## Environment Notes

- `NEXT_PUBLIC_API_ORIGIN` should point to the backend origin (used to derive `ws://` or `wss://`).
- `WORKSPACE_CHAT_MODEL` controls the OpenAI model (default `gpt-4o-mini`).
- Cost guardrails apply via `MONTHLY_AI_BUDGET` and `MAX_TOKENS_PER_CALL`.

