import { MODELS } from "./constants.js";

export default {
    async fetch(request, env) {
        const API_KEY = env.API_KEY;
        const url = new URL(request.url);
        const auth = request.headers.get("Authorization");

        // 🔐 Simple API key check
        if (auth !== `Bearer ${API_KEY}`) {
            return json({ error: "Unauthorized" }, 401);
        }

        if (request.method === "GET" && url.pathname === "/models") {
            return json({models: MODELS});
        }

        // 🚫 Only allow POST requests to /
        if (request.method !== "POST" || url.pathname !== "/run-model") {
            return json({ error: "Not allowed" }, 405);
        }

        try {
            const {
                modelPayload,
                model,
                contentType
             } = await request.json();

            log({
                modelPayload,
                model,
                contentType
            })

            if (!modelPayload) return json({ error: "modelPayload parameter is required" }, 400);

            if (!contentType) return json({ error: "contentType parameter is required" }, 400);

            if (!MODELS.includes(model) || !model) return json({ error: `Model does not exist. Available models: ${MODELS.toString()}` }, 400);

            // 🧠 Generate image from prompt
            const result = await env.AI.run(
                model,
                modelPayload
            );

            return new Response(result.response ?? JSON.stringify(result), {
                headers: { "Content-Type": contentType },
            });
        } catch (err) {
            return json({ error: "Failed to generate content", details: err.message }, 500);
        }
    },
};

// 📦 Function to return JSON responses
function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function log(text, type = 'log') {
    console[type](text)
}
