import { ALL_MODELS, MODEL_META, MODELS, REALTIME_MODELS, VISION_MODELS, CONN } from "./constants.js";

export default {
    async fetch(request, env) {
        const API_KEY = env.API_KEY;
        const url = new URL(request.url);
        const auth = request.headers.get("Authorization");

        // 🔐 Simple API key check
        if (auth !== `Bearer ${API_KEY}`) {
            return json({ error: "Unauthorized" }, 401);
        }

        // ─── GET /models ──────────────────────────────────────────────────────
        if (request.method === "GET" && url.pathname === "/models") {
            return json({ models: ALL_MODELS });
        }

        // ─── GET /models/:model/content-type ─────────────────────────────────
        //   Returns the output contentType, taskType, and supported connectionTypes
        //   for the requested model.
        const contentTypeMatch = url.pathname.match(/^\/models\/(.+)\/content-type$/);
        if (request.method === "GET" && contentTypeMatch) {
            const model = decodeURIComponent(contentTypeMatch[1]);
            if (!MODELS.includes(model)) {
                return json({ error: `Model not found: ${model}` }, 404);
            }
            const modelMeta = MODEL_META[model];
            if (!modelMeta) {
                return json({ error: `No metadata available for model: ${model}` }, 404);
            }
            return json({
                model,
                contentType:     modelMeta.contentType,
                taskType:        modelMeta.taskType,
                connectionTypes: modelMeta.connectionTypes,
                connectionInfo: {
                    batch:    modelMeta.connectionTypes.includes(CONN.BATCH)    ? "POST /run-model/:model" : null,
                    stream:   modelMeta.connectionTypes.includes(CONN.STREAM)   ? "POST /run-model/:model  (include stream:true in payload)" : null,
                    realtime: modelMeta.connectionTypes.includes(CONN.REALTIME) ? "GET  /realtime/:model  (WebSocket upgrade)" : null,
                },
            });
        }

        // ─── GET /realtime/:model  (WebSocket upgrade) ────────────────────────
        //   Proxies a real-time WebSocket connection to the Cloudflare AI
        //   real-time API.  Requires env.CF_ACCOUNT_ID and env.CF_API_TOKEN.
        const realtimeMatch = url.pathname.match(/^\/realtime\/(.+)$/);
        if (request.method === "GET" && realtimeMatch) {
            const model = decodeURIComponent(realtimeMatch[1]);

            if (!MODELS.includes(model)) {
                return json({ error: `Model not found: ${model}` }, 404);
            }
            if (!REALTIME_MODELS.has(model)) {
                return json({
                    error: `Model '${model}' does not support real-time connections.`,
                    hint:  "Check connectionTypes via GET /models/:model/content-type",
                }, 400);
            }

            const upgradeHeader = request.headers.get("Upgrade");
            if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
                return json({ error: "Expected Upgrade: websocket" }, 426);
            }

            if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) {
                return json({
                    error: "Real-time connections require CF_ACCOUNT_ID and CF_API_TOKEN secrets.",
                }, 500);
            }

            return handleRealtimeProxy(request, model, env);
        }

        // ─── POST /run-model/:model ───────────────────────────────────────────
        const runModelMatch = url.pathname.match(/^\/run-model\/(.+)$/);
        if (request.method !== "POST" || !runModelMatch) {
            return json({ error: "Not allowed" }, 405);
        }

        const model = decodeURIComponent(runModelMatch[1]);

        try {
            const { modelPayload, stream = false } = await request.json();

            log({ modelPayload, model, stream });

            if (!modelPayload) return json({ error: "modelPayload parameter is required" }, 400);
            if (!MODELS.includes(model)) {
                return json({ error: `Model does not exist. Available models: ${MODELS.toString()}` }, 400);
            }

            const modelMeta = MODEL_META[model];

            // ── Streaming (SSE) ─────────────────────────────────────────────
            if (stream) {
                if (!modelMeta?.connectionTypes.includes(CONN.STREAM)) {
                    return json({ error: `Model '${model}' does not support streaming.` }, 400);
                }
                const aiStream = await env.AI.run(model, { ...normalizePayload(modelPayload, model), stream: true });
                return new Response(aiStream, {
                    headers: {
                        "Content-Type": "text/event-stream",
                        "Cache-Control": "no-cache",
                        "Connection":    "keep-alive",
                    },
                });
            }

            // ── Batch inference ─────────────────────────────────────────────
            const result = await env.AI.run(model, normalizePayload(modelPayload, model));
            const contentType = modelMeta?.contentType ?? "application/json";

            // Binary results (images, audio) are returned as-is
            if (result instanceof ReadableStream || result instanceof ArrayBuffer || ArrayBuffer.isView(result)) {
                return new Response(result, { headers: { "Content-Type": contentType } });
            }

            // JSON-serialisable results
            const body = result?.response !== undefined ? result.response : JSON.stringify(result);
            return new Response(typeof body === "string" ? body : JSON.stringify(body), {
                headers: { "Content-Type": contentType },
            });
        } catch (err) {
            return json({ error: "Failed to generate content", details: err.message }, 500);
        }
    },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalise the incoming modelPayload so that vision/image-input models receive
 * their `image` field as a Uint8Array when the client sends a base64 string.
 */
function normalizePayload(payload, model) {
    if (!VISION_MODELS.has(model)) return payload;

    // image field may be a base64 string (browser-friendly) or already binary
    if (payload.image && typeof payload.image === "string") {
        try {
            const binaryStr = atob(payload.image);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
            return { ...payload, image: [...bytes] }; // Workers AI accepts Array<number>
        } catch {
            // not valid base64 — pass through unchanged
        }
    }
    return payload;
}

/**
 * Proxy an incoming WebSocket connection to the Cloudflare AI real-time
 * WebSocket endpoint, bidirectionally forwarding all messages.
 */
async function handleRealtimeProxy(request, model, env) {
    const upstreamUrl =
        `wss://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${encodeURIComponent(model)}`;

    // Connect to upstream
    let upstreamResponse;
    try {
        upstreamResponse = await fetch(upstreamUrl, {
            headers: {
                Authorization: `Bearer ${env.CF_API_TOKEN}`,
                Upgrade:       "websocket",
                Connection:    "Upgrade",
            },
        });
    } catch (err) {
        return json({ error: "Failed to connect to upstream real-time endpoint", details: err.message }, 502);
    }

    if (upstreamResponse.status !== 101) {
        return json({
            error:   "Upstream did not accept WebSocket upgrade",
            status:  upstreamResponse.status,
        }, 502);
    }

    const upstreamSocket = upstreamResponse.webSocket;
    if (!upstreamSocket) {
        return json({ error: "No WebSocket returned from upstream" }, 502);
    }
    upstreamSocket.accept();

    // Create a WebSocketPair for the client
    const pair = new WebSocketPair();
    const [clientSocket, serverSocket] = Object.values(pair);
    serverSocket.accept();

    // Client → upstream
    serverSocket.addEventListener("message", (event) => {
        try { upstreamSocket.send(event.data); } catch { /* ignore closed */ }
    });
    serverSocket.addEventListener("close", (event) => {
        try { upstreamSocket.close(event.code, event.reason); } catch { /* ignore */ }
    });
    serverSocket.addEventListener("error", () => {
        try { upstreamSocket.close(1011, "client error"); } catch { /* ignore */ }
    });

    // Upstream → client
    upstreamSocket.addEventListener("message", (event) => {
        try { serverSocket.send(event.data); } catch { /* ignore closed */ }
    });
    upstreamSocket.addEventListener("close", (event) => {
        try { serverSocket.close(event.code, event.reason); } catch { /* ignore */ }
    });
    upstreamSocket.addEventListener("error", () => {
        try { serverSocket.close(1011, "upstream error"); } catch { /* ignore */ }
    });

    return new Response(null, { status: 101, webSocket: clientSocket });
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function log(text, type = "log") {
    console[type](text);
}
