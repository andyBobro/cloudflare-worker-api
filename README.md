# imgena

A Cloudflare Worker that proxies Cloudflare Workers AI models over a simple HTTP/WebSocket API.

## Authentication

Every request must include an `Authorization` header:

```
Authorization: Bearer <API_KEY>
```

`API_KEY` is set as a Wrangler secret (`npx wrangler secret put API_KEY`).

---

## Endpoints

### `GET /models`

Returns the full list of available models with their names and descriptions.

**Response**
```json
{
  "models": [
    { "name": "@cf/meta/llama-3.2-3b-instruct", "description": "..." },
    ...
  ]
}
```

---

### `GET /models/:model/content-type`

Returns metadata for a specific model: its output content type, task category, and the connection modes it supports.

`:model` must be URL-encoded (e.g. `@cf/meta/llama-3.2-3b-instruct` → `%40cf%2Fmeta%2Fllama-3.2-3b-instruct`).

**Response**
```json
{
  "model": "@cf/black-forest-labs/flux-1-schnell",
  "contentType": "image/png",
  "taskType": "Text-to-Image",
  "connectionTypes": ["batch"],
  "connectionInfo": {
    "batch": "POST /run-model/:model",
    "stream": null,
    "realtime": null
  }
}
```

**Connection types**

| Value | Description |
|---|---|
| `batch` | Standard HTTP POST — all models |
| `stream` | Server-Sent Events — text generation / image-to-text models |
| `realtime` | WebSocket — real-time voice models (Deepgram, Pipecat) |

---

### `POST /run-model/:model`

Runs a model and returns its output. Supports batch inference and SSE streaming.

**Body**

| Field | Type | Required | Description |
|---|---|---|---|
| `modelPayload` | object | ✅ | The input passed directly to the model (prompt, messages, audio, etc.) |
| `stream` | boolean | ❌ | Set `true` to receive a streaming SSE response. Only valid for models with the `stream` connection type. Default: `false` |

#### Batch — text generation

```http
POST /run-model/%40cf%2Fmeta%2Fllama-3.2-3b-instruct
Content-Type: application/json

{
  "modelPayload": {
    "messages": [{ "role": "user", "content": "What is the capital of France?" }]
  }
}
```

#### Batch — text-to-image

Returns raw `image/png` bytes.

```http
POST /run-model/%40cf%2Fblack-forest-labs%2Fflux-1-schnell
Content-Type: application/json

{
  "modelPayload": { "prompt": "A sunset over the ocean" }
}
```

#### Batch — vision / image-to-text

The `image` field in `modelPayload` can be a **base64-encoded string** — the worker decodes it to binary automatically before forwarding to the model.

```http
POST /run-model/%40cf%2Fmeta%2Fllama-3.2-11b-vision-instruct
Content-Type: application/json

{
  "modelPayload": {
    "image": "<base64-encoded image>",
    "prompt": "Describe this image"
  }
}
```

#### Batch — speech recognition

```http
POST /run-model/%40cf%2Fopenai%2Fwhisper
Content-Type: application/json

{
  "modelPayload": {
    "audio": "<base64-encoded audio>"
  }
}
```

#### Streaming (SSE)

Add `"stream": true` to any text-generation request. The response is a `text/event-stream` where each event contains a JSON delta.

```http
POST /run-model/%40cf%2Fmeta%2Fllama-3.2-3b-instruct
Content-Type: application/json

{
  "modelPayload": {
    "messages": [{ "role": "user", "content": "Tell me a joke" }]
  },
  "stream": true
}
```

```
data: {"response":"Why"}
data: {"response":" don't"}
data: {"response":" scientists"}
...
data: [DONE]
```

---

### `GET /realtime/:model` — WebSocket

Opens a bidirectional WebSocket connection to the Cloudflare AI real-time endpoint for the requested model. The worker acts as a transparent proxy, forwarding all messages in both directions.

**Supported models** (those with the `realtime` connection type):

| Model | Task |
|---|---|
| `@cf/deepgram/nova-3` | Speech-to-text |
| `@cf/deepgram/flux` | Speech-to-text (voice agents) |
| `@cf/deepgram/aura-1` | Text-to-speech |
| `@cf/deepgram/aura-2-en` | Text-to-speech |
| `@cf/deepgram/aura-2-es` | Text-to-speech |
| `@cf/pipecat-ai/smart-turn-v2` | Voice activity detection |

> **Required secrets:** `CF_ACCOUNT_ID` and `CF_API_TOKEN` must be set as Wrangler secrets for this endpoint to work.

**Example (JavaScript)**
```js
const ws = new WebSocket(
  "wss://<worker-domain>/realtime/%40cf%2Fdeepgram%2Fnova-3",
  { headers: { Authorization: "Bearer <API_KEY>" } }
);

ws.onopen = () => ws.send(JSON.stringify({ /* Deepgram config */ }));
ws.onmessage = (e) => console.log(JSON.parse(e.data));
```

---

## Setup

```bash
# Install dependencies
npm install

# Set required secrets
npx wrangler secret put API_KEY

# Secrets needed only for /realtime endpoints
npx wrangler secret put CF_ACCOUNT_ID
npx wrangler secret put CF_API_TOKEN

# Run locally
npx wrangler dev

# Deploy
npx wrangler deploy
```
