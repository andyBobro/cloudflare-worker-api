const MODELS = [
    "@cf/moonshotai/kimi-k2.7-code",
    "@cf/zai-org/glm-4.7-flash",
    "@cf/openai/gpt-oss-120b",
    "@cf/meta/llama-4-scout-17b-16e-instruct",
    "@cf/moondream/moondream3.1-9b-a2b",
    "@cf/zai-org/glm-5.2",
    "@cf/moonshotai/kimi-k2.6",
    "@cf/google/gemma-4-26b-a4b-it",
    "@cf/nvidia/nemotron-3-120b-a12b",
    "@cf/moonshotai/kimi-k2.5",
    "@cf/black-forest-labs/flux-2-klein-9b",
    "@cf/black-forest-labs/flux-2-klein-4b",
    "@cf/black-forest-labs/flux-2-dev",
    "@cf/deepgram/aura-2-es",
    "@cf/deepgram/aura-2-en",
    "@cf/ibm-granite/granite-4.0-h-micro",
    "@cf/deepgram/flux",
    "@cf/pfnet/plamo-embedding-1b",
    "@cf/aisingapore/gemma-sea-lion-v4-27b-it",
    "@cf/ai4bharat/indictrans2-en-indic-1b",
    "@cf/google/embeddinggemma-300m",
    "@cf/deepgram/aura-1",
    "@cf/leonardo/lucid-origin",
    "@cf/leonardo/phoenix-1.0",
    "@cf/openai/gpt-oss-20b",
    "@cf/pipecat-ai/smart-turn-v2",
    "@cf/qwen/qwen3-embedding-0.6b",
    "@cf/deepgram/nova-3",
    "@cf/qwen/qwen3-30b-a3b-fp8",
    "@cf/google/gemma-3-12b-it",
    "@cf/mistralai/mistral-small-3.1-24b-instruct",
    "@cf/qwen/qwq-32b",
    "@cf/qwen/qwen2.5-coder-32b-instruct",
    "@cf/baai/bge-reranker-base",
    "@cf/meta/llama-guard-3-8b",
    "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    "@cf/meta/llama-3.2-1b-instruct",
    "@cf/meta/llama-3.2-3b-instruct",
    "@cf/meta/llama-3.2-11b-vision-instruct",
    "@cf/black-forest-labs/flux-1-schnell",
    "@cf/meta/llama-3.1-8b-instruct-awq",
    "@cf/meta/llama-3.1-8b-instruct-fp8",
    "@cf/myshell-ai/melotts",
    "@cf/meta/llama-3.1-8b-instruct",
    "@cf/baai/bge-m3",
    "@hf/meta-llama/meta-llama-3-8b-instruct",
    "@cf/openai/whisper-large-v3-turbo",
    "@cf/meta/llama-3-8b-instruct-awq",
    "@cf/llava-hf/llava-1.5-7b-hf",
    "@cf/openai/whisper-tiny-en",
    "@cf/meta/llama-3-8b-instruct",
    "@hf/mistral/mistral-7b-instruct-v0.2",
    "@cf/google/gemma-7b-it-lora",
    "@cf/google/gemma-2b-it-lora",
    "@cf/meta-llama/llama-2-7b-chat-hf-lora",
    "@hf/google/gemma-7b-it",
    "@hf/nousresearch/hermes-2-pro-mistral-7b",
    "@cf/mistral/mistral-7b-instruct-v0.2-lora",
    "@cf/unum/uform-gen2-qwen-500m",
    "@cf/facebook/bart-large-cnn",
    "@cf/microsoft/phi-2",
    "@cf/defog/sqlcoder-7b-2",
    "@cf/facebook/detr-resnet-50",
    "@cf/bytedance/stable-diffusion-xl-lightning",
    "@cf/lykon/dreamshaper-8-lcm",
    "@cf/runwayml/stable-diffusion-v1-5-img2img",
    "@cf/runwayml/stable-diffusion-v1-5-inpainting",
    "@cf/stabilityai/stable-diffusion-xl-base-1.0",
    "@cf/baai/bge-large-en-v1.5",
    "@cf/baai/bge-small-en-v1.5",
    "@cf/meta/llama-2-7b-chat-fp16",
    "@cf/mistral/mistral-7b-instruct-v0.1",
    "@cf/baai/bge-base-en-v1.5",
    "@cf/huggingface/distilbert-sst-2-int8",
    "@cf/meta/llama-2-7b-chat-int8",
    "@cf/meta/m2m100-1.2b",
    "@cf/microsoft/resnet-50",
    "@cf/openai/whisper",
    "@cf/meta/llama-3.1-70b-instruct",
    "@cf/meta/llama-3.1-8b-instruct-fast"
]

export default {
    async fetch(request, env) {
        const API_KEY = env.API_KEY;
        const url = new URL(request.url);
        
        // 🔐 Extract auth token (Header or URL parameter for WebSockets/Streams)
        const authHeader = request.headers.get("Authorization");
        const authToken = authHeader 
            ? authHeader.replace("Bearer ", "") 
            : url.searchParams.get("api_key");

        if (authToken !== API_KEY) {
            return json({ error: "Unauthorized" }, 401);
        }

        // 📋 List available models
        if (request.method === "GET" && url.pathname === "/models") {
            return json({ models: MODELS });
        }

        // 🔌 1. HANDLE WEBSOCKET CONNECTIONS (Real-time Speech / Audio)
        if (request.headers.get("Upgrade") === "websocket") {
            return this.handleWebSocket(request, env);
        }

        // 🚫 Reject non-POST requests to /run-model
        if (request.method !== "POST" || url.pathname !== "/run-model") {
            return json({ error: "Endpoint or Method not allowed" }, 405);
        }

        // 🧠 2. HANDLE STANDARD HTTP & STREAMING REQUESTS
        try {
            const {
                modelPayload,
                model,
                contentType // Optional caller-specified content type
            } = await request.json();

            log({ modelPayload, model, contentType });

            if (!modelPayload) return json({ error: "modelPayload parameter is required" }, 400);
            if (!model) return json({ error: "model parameter is required" }, 400);
            if (!MODELS.includes(model)) return json({ error: `Model not supported.` }, 400);

            // Execute Workers AI Model
            const result = await env.AI.run(model, modelPayload);

            // 🌊 Case A: STREAMING RESPONSE (Text SSE OR Audio Stream Chunks)
            if (result instanceof ReadableStream) {
                // If contentType isn't provided, default to "text/event-stream" for LLMs
                const streamContentType = contentType || "text/event-stream";
                return new Response(result, {
                    headers: { 
                        "Content-Type": streamContentType,
                        "Cache-Control": "no-cache",
                        "Connection": "keep-alive",
                        "Transfer-Encoding": "chunked"
                    },
                });
            }

            // 🖼️🎵 Case B: RAW BINARY RESPONSE (Complete Image files / Audio files)
            if (result instanceof ArrayBuffer || result instanceof Uint8Array) {
                // Default fallback to octet-stream if caller didn't specify exact MIME type
                const binaryContentType = contentType || "application/octet-stream";
                return new Response(result, {
                    headers: { "Content-Type": binaryContentType },
                });
            }

            // 📄 Case C: STANDARD JSON / TEXT RESPONSE
            if (typeof result === "object") {
                return json(result);
            }

            // Plain text or string response
            return new Response(result.toString(), {
                headers: { "Content-Type": contentType || "text/plain; charset=utf-8" },
            });

        } catch (err) {
            return json({ error: "Failed to generate content", details: err.message }, 500);
        }
    },

    // 🔌 WebSocket Proxy Handler for Real-time Streaming Models
    async handleWebSocket(request, env) {
        const url = new URL(request.url);
        const model = url.searchParams.get("model");

        if (!model || !MODELS.includes(model)) {
            return new Response("Invalid or missing 'model' parameter in query string.", { status: 400 });
        }

        // Create Cloudflare WebSocket pair
        const [client, server] = Object.values(new WebSocketPair());
        server.accept();

        // Target endpoint on Cloudflare AI Gateway
        const gatewayName = env.AI_GATEWAY_NAME || "default";
        const accountId = env.CF_ACCOUNT_ID;
        const targetWsUrl = `wss://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayName}/workers-ai/${model}`;

        try {
            const aiSocket = new WebSocket(targetWsUrl, {
                headers: { "cf-aig-authorization": `Bearer ${env.API_KEY}` }
            });

            // Bidirectional pipe
            server.addEventListener("message", (evt) => {
                if (aiSocket.readyState === WebSocket.OPEN) aiSocket.send(evt.data);
            });

            aiSocket.addEventListener("message", (evt) => {
                if (server.readyState === WebSocket.OPEN) server.send(evt.data);
            });

            server.addEventListener("close", () => aiSocket.close());
            aiSocket.addEventListener("close", () => server.close());

        } catch (err) {
            server.send(JSON.stringify({ error: "WebSocket connection failed", details: err.message }));
            server.close();
        }

        return new Response(null, { status: 101, webSocket: client });
    }
};

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function log(text, type = "log") {
    console[type](text);
}