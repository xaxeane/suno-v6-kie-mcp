#!/usr/bin/env node
import { randomUUID, timingSafeEqual } from "node:crypto";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { isInitializeRequest, Server, } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import express from "express";
const VERSION = "1.0.0";
const KIE_BASE_URL = (process.env.KIE_AI_BASE_URL || "https://api.kie.ai").replace(/\/$/, "");
const API_KEY = process.env.KIE_AI_API_KEY || "";
const HTTP_TOKEN = process.env.KIE_MCP_HTTP_TOKEN || "";
const HTTP_HOST = process.env.MCP_HTTP_HOST || "127.0.0.1";
const HTTP_PORT = Number(process.env.MCP_HTTP_PORT || "3000");
const ALLOWED_HOSTS = (process.env.MCP_ALLOWED_HOSTS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
if (!API_KEY) {
    throw new Error("KIE_AI_API_KEY environment variable is required");
}
const generationTool = {
    name: "suno_generate_music",
    description: "Generate a song or instrumental track using Kie.ai Suno V6, V6_MINI, or V6_WILD. The returned task_id can be checked with suno_get_task_status.",
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["prompt", "customMode", "instrumental"],
        properties: {
            prompt: { type: "string", minLength: 1, maxLength: 5000, description: "Lyrics in custom mode, or a music idea in non-custom mode." },
            customMode: { type: "boolean", description: "Use advanced controls. Style and title are required when true." },
            instrumental: { type: "boolean", description: "Generate without vocals." },
            model: { type: "string", enum: ["V6", "V6_MINI", "V6_WILD"], default: "V6" },
            style: { type: "string", maxLength: 1000, description: "Genre, mood, or production style. Required in custom mode." },
            title: { type: "string", maxLength: 80, description: "Track title. Required in custom mode." },
            duration: { type: "number", minimum: 10, maximum: 360, description: "Seconds; custom mode only for V6 family." },
            negativeTags: { type: "string", maxLength: 200 },
            vocalGender: { type: "string", enum: ["m", "f"] },
            styleWeight: { type: "number", minimum: 0, maximum: 1 },
            weirdnessConstraint: { type: "number", minimum: 0, maximum: 1 },
            audioWeight: { type: "number", minimum: 0, maximum: 1 },
            personaId: { type: "string" },
            personaModel: { type: "string", enum: ["style_persona", "voice_persona"] },
            callBackUrl: { type: "string", format: "uri" }
        }
    }
};
const statusTool = {
    name: "suno_get_task_status",
    description: "Get the current status and generated audio URLs for a Kie.ai Suno task.",
    inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["taskId"],
        properties: { taskId: { type: "string", minLength: 1 } }
    }
};
function errorResult(message) {
    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: message }, null, 2) }], isError: true };
}
function validateGeneration(args) {
    if (typeof args.prompt !== "string" || args.prompt.length < 1 || args.prompt.length > 5000)
        throw new Error("prompt must be 1-5000 characters");
    if (typeof args.customMode !== "boolean")
        throw new Error("customMode is required and must be boolean");
    if (typeof args.instrumental !== "boolean")
        throw new Error("instrumental is required and must be boolean");
    if (args.customMode && (typeof args.style !== "string" || !args.style || typeof args.title !== "string" || !args.title))
        throw new Error("style and title are required when customMode is true");
    if (args.duration !== undefined && (!args.customMode || typeof args.duration !== "number" || args.duration < 10 || args.duration > 360))
        throw new Error("duration is valid only in customMode and must be between 10 and 360 seconds");
    const model = args.model ?? "V6";
    if (model !== "V6" && model !== "V6_MINI" && model !== "V6_WILD")
        throw new Error("model must be V6, V6_MINI, or V6_WILD");
    return model;
}
async function kieRequest(path, init = {}) {
    const response = await fetch(`${KIE_BASE_URL}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || (typeof body.code === "number" && body.code !== 200))
        throw new Error(body.msg || `Kie.ai request failed (${response.status})`);
    return body;
}
async function generateMusic(args) {
    const model = validateGeneration(args);
    const input = {
        prompt: args.prompt,
        custom_mode: args.customMode,
        instrumental: args.instrumental,
        model,
    };
    const mappings = {
        style: "style", title: "title", duration: "duration", negativeTags: "negative_tags",
        vocalGender: "vocal_gender", styleWeight: "style_weight", weirdnessConstraint: "weirdness_constraint",
        audioWeight: "audio_weight", personaId: "persona_id", personaModel: "persona_model"
    };
    for (const [from, to] of Object.entries(mappings))
        if (args[from] !== undefined)
            input[to] = args[from];
    const body = { model: "ai-music-api/generate", input };
    if (typeof args.callBackUrl === "string")
        body.callBackUrl = args.callBackUrl;
    const result = await kieRequest("/api/v1/jobs/createTask", { method: "POST", body: JSON.stringify(body) });
    const data = result.data;
    const taskId = data?.taskId;
    if (typeof taskId !== "string")
        throw new Error("Kie.ai did not return a taskId");
    return { success: true, task_id: taskId, model, message: "Suno V6 generation task created", next_step: "Call suno_get_task_status with this task_id" };
}
async function getTaskStatus(taskId) {
    if (!taskId)
        throw new Error("taskId is required");
    const result = await kieRequest(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, { method: "GET" });
    const data = (result.data || {});
    let parsedResult = undefined;
    if (typeof data.resultJson === "string") {
        try {
            parsedResult = JSON.parse(data.resultJson);
        }
        catch {
            parsedResult = data.resultJson;
        }
    }
    return { success: true, task_id: data.taskId || taskId, state: data.state, model: data.model, result: parsedResult, message: result.msg };
}
function makeServer() {
    const server = new Server({ name: "suno-v6-kie-mcp", version: VERSION }, { capabilities: { tools: {} } });
    server.setRequestHandler("tools/list", async () => ({ tools: [generationTool, statusTool] }));
    server.setRequestHandler("tools/call", async (request) => {
        const name = request.params.name;
        const args = (request.params.arguments || {});
        try {
            const value = name === "suno_generate_music" ? await generateMusic(args) : name === "suno_get_task_status" ? await getTaskStatus(String(args.taskId || "")) : (() => { throw new Error(`Unknown tool: ${name}`); })();
            return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
        }
        catch (error) {
            return errorResult(error instanceof Error ? error.message : String(error));
        }
    });
    return server;
}
async function runStdio() {
    await makeServer().connect(new StdioServerTransport());
}
function authorized(req, res) {
    if (HTTP_TOKEN) {
        const expected = Buffer.from(`Bearer ${HTTP_TOKEN}`);
        const supplied = Buffer.from(req.headers.authorization || "");
        if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
            res.status(401).json({ error: "Unauthorized" });
            return false;
        }
    }
    if (ALLOWED_HOSTS.length && !ALLOWED_HOSTS.includes(String(req.headers.host || "").split(":")[0].toLowerCase())) {
        res.status(403).json({ error: "Invalid Host header" });
        return false;
    }
    return true;
}
function runHttp() {
    if (HTTP_HOST !== "127.0.0.1" && HTTP_HOST !== "localhost" && (!HTTP_TOKEN || !ALLOWED_HOSTS.length))
        throw new Error("Public HTTP requires KIE_MCP_HTTP_TOKEN and MCP_ALLOWED_HOSTS");
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    const sessions = new Map();
    app.get("/health", (_req, res) => res.json({ status: "ok", transport: "streamable-http", version: VERSION }));
    app.post("/mcp", (req, res) => {
        if (!authorized(req, res))
            return;
        void (async () => {
            let transport = sessions.get(String(req.headers["mcp-session-id"] || ""));
            if (!transport) {
                if (req.headers["mcp-session-id"] || !isInitializeRequest(req.body)) {
                    res.status(400).json({ error: "Missing or invalid MCP session" });
                    return;
                }
                const sessionId = randomUUID();
                transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: () => sessionId, onsessioninitialized: () => { sessions.set(sessionId, transport); } });
                transport.onclose = () => sessions.delete(sessionId);
                await makeServer().connect(transport);
            }
            await transport.handleRequest(req, res, req.body);
        })().catch((error) => { if (!res.headersSent)
            res.status(500).json({ error: error instanceof Error ? error.message : String(error) }); });
    });
    const sessionRequest = (req, res) => {
        if (!authorized(req, res))
            return;
        const id = String(req.headers["mcp-session-id"] || "");
        const transport = sessions.get(id);
        if (!transport) {
            res.status(404).send("Session not found");
            return;
        }
        void transport.handleRequest(req, res).catch((error) => { if (!res.headersSent)
            res.status(500).json({ error: String(error) }); });
    };
    app.get("/mcp", sessionRequest);
    app.delete("/mcp", sessionRequest);
    app.listen(HTTP_PORT, HTTP_HOST, () => console.error(`Suno V6 MCP listening on http://${HTTP_HOST}:${HTTP_PORT}/mcp`));
}
if (process.env.MCP_TRANSPORT === "http" || process.argv.includes("--http"))
    runHttp();
else
    void runStdio();
//# sourceMappingURL=index.js.map