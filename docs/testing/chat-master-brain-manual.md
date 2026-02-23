# Chat Master-Brain Manual Verification

This checklist validates the end-to-end behavior when running against real data jobs:

- `f3f6ccd8-c995-4e9f-8d48-d1df90f80ba2`
- `0d4c899a-ad2c-48f8-94df-576247fdbfd8`

## 1) Workspace chat evidence flow

1. Open `/research/<jobId>?module=chat`.
2. Send: `Give me 5 examples and link the exact posts/videos.`
3. Verify:
   - assistant message appears with links (`table` or `evidence_list` block),
   - `source_list` is present,
   - browser console has no runtime errors.

## 2) Mutation safety flow

1. In workspace chat, send: `Delete competitor @examplehandle from competitors`.
2. Verify:
   - assistant provides a **preview** action (`mutation_stage`) instead of direct delete.
   - clicking preview creates a `mutation_preview` block with warnings.
   - no DB mutation happens before clicking **Confirm apply**.
3. Click **Confirm apply**, verify change appears in Intelligence.
4. Click **Undo mutation**, verify records restore.

## 3) Document generation flow

1. In workspace chat, request a PDF (for example: `Generate a competitor audit PDF`).
2. Verify:
   - PDF opens from `/storage/docs/...`,
   - chat message includes a PDF attachment card,
   - attachment link opens/downloads correctly.

## 4) WS contract test

Run:

```bash
npm run test:chat-ws-contract --workspace=apps/backend
```

Expected:
- for each configured job id, sequence includes:
  - `AUTH_OK`
  - `HISTORY`
  - `ASSISTANT_START`
  - `ASSISTANT_DELTA`
  - `ASSISTANT_BLOCKS`
  - `ASSISTANT_DONE`

## 5) Frontend smoke test

Run (with frontend server available):

```bash
npm run test:e2e:chat --workspace=apps/frontend
```

Expected:
- workspace chat sends and receives a response for each job id,
- strategy docs chat sends and receives a response for each job id.

