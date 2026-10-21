#!/usr/bin/env node
// A free local model (Ollama / LM Studio) through the "local" provider: the
// login stores address + models, the registry lists it (text-only allowed),
// and a turn speaks Chat Completions with tool calls against a fake server.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { localBase, localModelIds, localModel, localProvider } from "../bin/agent/local-provider.mjs";

assert.equal(localBase("http://localhost:11434"), "http://localhost:11434/v1");
assert.equal(localBase("http://127.0.0.1:1234/v1/"), "http://127.0.0.1:1234/v1");
assert.equal(localBase(""), "http://127.0.0.1:11434/v1");
assert.throws(() => localBase("ftp://x"));
assert.deepEqual(localModelIds("qwen2.5:7b, llama3.1:8b qwen2.5:7b"), ["qwen2.5:7b", "llama3.1:8b"]);
assert.deepEqual(localModel("qwen2.5:7b", "b").input, ["text"]);
assert.deepEqual(localModel("qwen2.5vl:7b", "b").input, ["text", "image"]);

// login flow: address, models, empty key
{
	const provider = await localProvider({ env: {} });
	const answers = ["http://127.0.0.1:1234", "qwen3:8b", ""];
	const credential = await provider.auth.apiKey.login({ signal: new AbortController().signal, prompt: async () => answers.shift() });
	assert.deepEqual(credential, { type: "api_key", key: "local", env: { LOCAL_LLM_BASE_URL: "http://127.0.0.1:1234/v1", LOCAL_LLM_MODELS: "qwen3:8b" } });
	const rebuilt = await localProvider({ env: {}, credential });
	assert.deepEqual(rebuilt.getModels().map((m) => [m.id, m.baseUrl, m.api]), [["qwen3:8b", "http://127.0.0.1:1234/v1", "openai-completions"]]);
}

// a tool-calling turn against a fake OpenAI-compatible server
const seen = [];
const server = createServer((req, res) => {
	let body = "";
	req.on("data", (c) => { body += c; });
	req.on("end", () => {
		seen.push({ url: req.url, body: JSON.parse(body || "{}") });
		res.writeHead(200, { "content-type": "text/event-stream" });
		const chunk = (d) => res.write(`data: ${JSON.stringify(d)}\n\n`);
		chunk({ id: "1", object: "chat.completion.chunk", model: "qwen2.5:7b", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "frame_shot", arguments: "" } }] } }] });
		chunk({ id: "1", object: "chat.completion.chunk", model: "qwen2.5:7b", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "{\"view\":\"profile\"}" } }] } }] });
		chunk({ id: "1", object: "chat.completion.chunk", model: "qwen2.5:7b", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
		res.end("data: [DONE]\n\n");
	});
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
	const { createModels, InMemoryCredentialStore, Type } = await import("@earendil-works/pi-ai");
	const base = `http://127.0.0.1:${server.address().port}/v1`;
	const provider = await localProvider({ env: { LOCAL_LLM_BASE_URL: base, LOCAL_LLM_MODELS: "qwen2.5:7b" } });
	const models = createModels({ credentials: new InMemoryCredentialStore() });
	models.setProvider(provider);
	await models.login?.("local", "api_key", { signal: new AbortController().signal, prompt: async (p) => (/address/i.test(p.message) ? base : /model/i.test(p.message) ? "qwen2.5:7b" : "") }).catch(() => {});
	const model = models.getModel("local", "qwen2.5:7b");
	const tools = [{ name: "frame_shot", description: "Frame the shot", parameters: Type.Object({ view: Type.String() }) }];
	const reply = await models.completeSimple(model, { systemPrompt: "You direct a 3D previs scene.", messages: [{ role: "user", content: "측면으로 찍어줘", timestamp: Date.now() }], tools });
	const call = reply.content.find((part) => part.type === "toolCall");
	assert.ok(call, `a tool call comes back (got ${JSON.stringify(reply).slice(0, 300)})`);
	assert.equal(call.name, "frame_shot");
	assert.deepEqual(call.arguments, { view: "profile" });
	const request = seen.at(-1);
	assert.equal(request.url, "/v1/chat/completions");
	assert.equal(request.body.model, "qwen2.5:7b");
	assert.equal(request.body.tools[0].function.name, "frame_shot");
	assert.ok(!("store" in request.body) && !("reasoning_effort" in request.body), "no paid-API-only fields");
	assert.ok(request.body.messages.every((m) => m.role !== "developer"), "system prompt rides the system role");
} finally {
	server.close();
}
console.log("PASS local OpenAI-compatible model (Ollama / LM Studio) with tool calls");
