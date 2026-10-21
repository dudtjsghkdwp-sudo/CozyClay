// A free local model behind an OpenAI-compatible server: Ollama (http://127.0.0.1:11434/v1),
// LM Studio (http://127.0.0.1:1234/v1), llama.cpp server, vLLM... The login asks for the server
// address, the model name(s) and an optional key, and stores them as one api-key credential whose
// env carries the address and models, like CLIProxyAPI. Requests go from this Node sidecar, never
// from the browser, so the local server needs no CORS setting. Chat Completions + tool calls.

const LOCAL_DEFAULT_BASE = "http://127.0.0.1:11434/v1";
const BASE_ENV = "LOCAL_LLM_BASE_URL";
const MODELS_ENV = "LOCAL_LLM_MODELS";
const KEY_ENV = "LOCAL_LLM_API_KEY";
// Local servers ignore the key, but the OpenAI client sends one; any non-empty value works.
const PLACEHOLDER_KEY = "local";
const VISION = /(^|[-_:/.])(vl|vision|llava|bakllava|minicpm-v|moondream|gemma3|gemma-3|qwen2\.5vl|qwen2\.5-vl|qwen3-vl|llama3\.2-vision|pixtral|mistral-small3\.[12])/i;

/** An address as typed: http(s), no trailing slash, always ending in /v1. */
export function localBase(value) {
	const raw = String(value ?? "").trim() || LOCAL_DEFAULT_BASE;
	const url = new URL(raw);
	if (!["http:", "https:"].includes(url.protocol)) throw new Error("The server address must start with http:// or https://.");
	const base = url.href.replace(/\/+$/, "");
	return /\/v1$/.test(base) ? base : `${base}/v1`;
}

/** "qwen2.5:7b, llama3.1:8b" -> ["qwen2.5:7b", "llama3.1:8b"] */
export function localModelIds(value) {
	return [...new Set(String(value ?? "").split(/[\s,]+/).map((id) => id.trim()).filter(Boolean))];
}

/** One pi model for a local id: Chat Completions, no paid-API-only fields. */
export function localModel(id, baseUrl) {
	return {
		id, name: `${id} (local)`, api: "openai-completions", provider: "local", baseUrl,
		reasoning: false,
		input: VISION.test(id) ? ["text", "image"] : ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 32768, maxTokens: 8192,
		// Ollama/LM Studio speak plain chat-completions: no developer role, store,
		// reasoning_effort or strict tool schemas; max_tokens, not max_completion_tokens.
		compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, supportsStrictMode: false, maxTokensField: "max_tokens", supportsLongCacheRetention: false },
	};
}

/** Where the registry builds the local models from: environment, then the stored credential, then the default. */
function localSettings({ env = process.env, credential } = {}) {
	const pick = (name) => (typeof env?.[name] === "string" && env[name].trim()) || credential?.env?.[name] || "";
	return { base: localBase(pick(BASE_ENV) || LOCAL_DEFAULT_BASE), models: localModelIds(pick(MODELS_ENV)) };
}

function localAuth() {
	return {
		name: "Local model (Ollama / LM Studio) — free, no key",
		login: async (interaction) => {
			interaction.signal.throwIfAborted();
			const address = await interaction.prompt({ type: "text", message: "Server address (Ollama: http://127.0.0.1:11434/v1, LM Studio: http://127.0.0.1:1234/v1)", placeholder: LOCAL_DEFAULT_BASE });
			const base = localBase(address);
			interaction.signal.throwIfAborted();
			const models = localModelIds(await interaction.prompt({ type: "text", message: "Model name(s), comma separated (e.g. qwen2.5:7b)", placeholder: "qwen2.5:7b" }));
			if (!models.length) throw new Error("Enter at least one model name, e.g. qwen2.5:7b.");
			interaction.signal.throwIfAborted();
			const key = await interaction.prompt({ type: "text", message: "API key (leave empty for Ollama / LM Studio)", placeholder: "" });
			return { type: "api_key", key: String(key ?? "").trim() || PLACEHOLDER_KEY, env: { [BASE_ENV]: base, [MODELS_ENV]: models.join(",") } };
		},
		resolve: async ({ ctx, credential, signal }) => {
			signal.throwIfAborted();
			if (credential?.key) return { auth: { apiKey: credential.key }, env: credential.env, source: "stored credential" };
			const base = await ctx.env(BASE_ENV);
			if (!base) return undefined;
			return { auth: { apiKey: (await ctx.env(KEY_ENV)) || PLACEHOLDER_KEY }, source: BASE_ENV };
		},
	};
}

export async function localProvider({ env = process.env, credential } = {}) {
	const [{ createProvider }, { openAICompletionsApi }] = await Promise.all([
		import("@earendil-works/pi-ai"),
		import("@earendil-works/pi-ai/api/openai-completions.lazy"),
	]);
	const { base, models } = localSettings({ env, credential });
	return createProvider({
		id: "local",
		name: "Local model (Ollama / LM Studio)",
		baseUrl: base,
		auth: { apiKey: localAuth() },
		models: models.map((id) => localModel(id, base)),
		api: openAICompletionsApi(),
	});
}
