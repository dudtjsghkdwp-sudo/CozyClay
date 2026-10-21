// Reference videos / images: attached to READ framing, camera angle and
// movement, and lighting from them — never to put their pixels in the scene.
// The store lives in memory (object URLs), not in the project file.
// Pure helpers (cut detection, analysis parsing, angle mapping) are exported
// for tests; the browser helpers sample frames through a <video> element.
import { referenceKind } from "./reference-media.js";
import { parseAnglePhrase } from "./shell/camera-command.js";
import { DEFAULT_SCENE_ANGLE, normalizeAngle } from "./shell/scene-camera-angle.js";

// ---------------------------------------------------------------- store
let state = { items: [], activeId: null, view: { mode: "off", opacity: 0.5, grid: true } };
const listeners = new Set();
const emit = () => { for (const fn of listeners) fn(); };
export const referenceStore = {
	subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
	get: () => state,
	set(patch) { state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) }; emit(); },
	update(id, patch) { referenceStore.set((s) => ({ items: s.items.map((it) => it.id === id ? { ...it, ...(typeof patch === "function" ? patch(it) : patch) } : it) })); },
	active: () => state.items.find((it) => it.id === state.activeId) ?? null,
	remove(id) { const it = state.items.find((x) => x.id === id); if (it?.url) URL.revokeObjectURL(it.url); referenceStore.set((s) => ({ items: s.items.filter((x) => x.id !== id), activeId: s.activeId === id ? (s.items.find((x) => x.id !== id)?.id ?? null) : s.activeId })); },
};
export const REFERENCE_ADDED_EVENT = "cozyclay:reference-added";

const withTimeout = (promise, ms, message) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);
function once(el, ok, ms, message) {
	return withTimeout(new Promise((resolve, reject) => {
		const done = () => { el.removeEventListener(ok, done); el.removeEventListener("error", fail); resolve(); };
		const fail = () => { el.removeEventListener(ok, done); el.removeEventListener("error", fail); reject(new Error(message)); };
		el.addEventListener(ok, done); el.addEventListener("error", fail);
	}), ms, message);
}
const CODEC_HINT = "이 브라우저가 재생할 수 없는 코덱일 수 있어요 (예: HEVC/H.265 .mov). MP4(H.264)나 WebM으로 변환해 주세요.";

/** Add a picked file as a reference (video or image). Resolves to the item. */
export async function addReferenceFile(file) {
	const kind = referenceKind(file);
	if (!kind) throw new Error(`${file?.name ?? "파일"}은(는) 이미지나 영상이 아니에요.`);
	const url = URL.createObjectURL(file);
	const item = { id: `ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name: file.name, kind, url, file, duration: 0, width: 0, height: 0, offset: 0, cuts: null, shots: [], status: "" };
	try {
		if (kind === "video") {
			const v = document.createElement("video");
			v.muted = true; v.playsInline = true; v.preload = "metadata"; v.src = url;
			await once(v, "loadedmetadata", 15000, `영상을 열지 못했어요. ${CODEC_HINT}`);
			if (!v.videoWidth) throw new Error(`영상에 화면이 없어요. ${CODEC_HINT}`);
			Object.assign(item, { duration: Number.isFinite(v.duration) ? v.duration : 0, width: v.videoWidth, height: v.videoHeight });
			v.removeAttribute("src"); v.load();
		} else {
			const img = new Image(); img.src = url;
			await withTimeout(img.decode(), 15000, "이미지를 열지 못했어요.");
			Object.assign(item, { width: img.naturalWidth, height: img.naturalHeight });
		}
	} catch (error) { URL.revokeObjectURL(url); throw error; }
	referenceStore.set((s) => ({ items: [...s.items, item], activeId: item.id, view: s.view.mode === "off" ? { ...s.view, mode: "side" } : s.view }));
	globalThis.dispatchEvent?.(new CustomEvent(REFERENCE_ADDED_EVENT, { detail: { id: item.id } }));
	return item;
}

// ---------------------------------------------------------------- cuts (pure)
/** Mean absolute difference of two equal-length RGB(A) signatures, 0..1. */
export function frameDifference(a, b) {
	if (!a || !b || a.length !== b.length) return 1;
	let sum = 0;
	for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
	return sum / (a.length * 255);
}

/**
 * Cut times from per-sample differences. diffs[i] is the change between
 * sample i-1 and i at times[i]. A cut is a spike well above the local level,
 * so a pan or flicker does not split a shot. Returns cut times in seconds.
 */
export function detectCuts(diffs, times, { threshold = 0.12, ratio = 3, minShot = 0.5, window = 8 } = {}) {
	const cuts = [];
	for (let i = 1; i < diffs.length; i++) {
		const lo = Math.max(1, i - window), hi = Math.min(diffs.length, i + window + 1);
		const around = [];
		for (let j = lo; j < hi; j++) if (j !== i) around.push(diffs[j]);
		around.sort((x, y) => x - y);
		const local = around.length ? around[Math.floor(around.length / 2)] : 0;
		if (diffs[i] < threshold || diffs[i] < local * ratio + 0.02) continue;
		const last = cuts.length ? cuts[cuts.length - 1] : 0;
		if (times[i] - last < minShot) continue;
		cuts.push(times[i]);
	}
	return cuts;
}

/** Shots ({start, end} seconds) between cuts over a duration. */
export function cutsToRanges(cuts, duration) {
	const edges = [0, ...cuts.filter((t) => t > 0 && t < duration), duration];
	return edges.slice(0, -1).map((start, i) => ({ start, end: edges[i + 1] }));
}

/** Timeline segments (inclusive frames) for camera-command shotsFromSegments. */
export function rangesToSegments(shots, fps, offsetSec = 0) {
	return shots.map((shot, i) => {
		const startFrame = Math.max(0, Math.round((shot.start - offsetSec) * fps));
		const endFrame = Math.max(startFrame, Math.round((shot.end - offsetSec) * fps) - 1);
		const parsed = shot.text ? parseAnglePhrase(shot.text) : null;
		const angle = normalizeAngle({ ...DEFAULT_SCENE_ANGLE, ...(shot.angle ?? {}), ...(parsed?.angle ?? {}) });
		return { startFrame, endFrame, angle, label: `참고 컷 ${i + 1}${shot.size ? ` ${shot.size}` : ""}` };
	}).filter((seg) => seg.endFrame >= 0);
}

// ---------------------------------------------------------------- heuristics (pure)
/** Brightness / colour temperature / motion words from frame statistics. */
export function heuristicNotes({ luma = 0.5, warmth = 0, motion = 0 } = {}) {
	const light = luma < 0.25 ? "어두운 조명(로우키)" : luma > 0.65 ? "밝은 조명(하이키)" : "보통 밝기";
	const temp = warmth > 0.06 ? "따뜻한 색온도" : warmth < -0.06 ? "차가운 색온도" : "중립 색온도";
	const move = motion > 0.06 ? "카메라/피사체 움직임 많음" : motion > 0.02 ? "약한 움직임" : "고정에 가까움";
	return `${light} · ${temp} · ${move}`;
}

// ---------------------------------------------------------------- AI analysis (pure)
export const ANALYSIS_PROMPT = `You are a cinematographer. Each attached image is one keyframe from consecutive shots of a reference video, in order. For EACH image return one object. Answer ONLY with JSON: {"shots":[{"shotSize":"extreme close-up|close-up|medium|full|wide","cameraHeight":"low|eye|high|top","horizontal":"front|three-quarter|side|back","lens":"wide|normal|tele","movement":"static|pan|tilt|dolly in|dolly out|tracking|handheld|crane","keyLight":{"direction":"front|side|back|top","softness":"soft|hard","colorTemp":"warm|neutral|cool"},"mood":"short phrase"}]}`;

const SIZE = { "extreme close-up": ["익스트림 클로즈업", 0.8, 30], "close-up": ["클로즈업", 1.2, 35], medium: ["미디엄", 2.2, 40], full: ["풀샷", 4, 45], wide: ["와이드", 6, 45] };
const HEIGHT = { low: ["로우 앵글", -20], eye: ["아이레벨", 5], high: ["하이 앵글", 40], top: ["탑뷰", 80] };
const HORIZ = { front: ["정면", 0], "three-quarter": ["앞 3/4", 45], side: ["측면", 90], back: ["뒷모습", 180] };
const LENS = { wide: ["광각", 60], normal: ["표준", null], tele: ["망원", 20] };
const MOVE = { static: "고정", pan: "팬", tilt: "틸트", "dolly in": "돌리 인", "dolly out": "돌리 아웃", tracking: "트래킹", handheld: "핸드헬드", crane: "크레인" };
const LDIR = { front: "정면광", side: "측광", back: "역광", top: "탑라이트" };
const key = (table, value) => { const v = String(value ?? "").toLowerCase().trim(); return Object.keys(table).find((k) => v === k) ?? Object.keys(table).find((k) => v.includes(k.split(" ")[0])); };

/** Pull {shots:[...]} out of a model reply (tolerates code fences / prose). */
export function parseAnalysis(text) {
	const raw = String(text ?? "");
	const start = raw.indexOf("{"), end = raw.lastIndexOf("}");
	if (start < 0 || end <= start) return null;
	try {
		const value = JSON.parse(raw.slice(start, end + 1));
		const shots = Array.isArray(value) ? value : Array.isArray(value?.shots) ? value.shots : [value];
		return shots.filter((s) => s && typeof s === "object");
	} catch { return null; }
}

/** One analysed shot → camera angle + editable Korean text + lighting preset. */
export function analysisToShot(a = {}) {
	const size = SIZE[key(SIZE, a.shotSize)], height = HEIGHT[key(HEIGHT, a.cameraHeight)], horiz = HORIZ[key(HORIZ, a.horizontal)];
	const lens = LENS[key(LENS, a.lens)], move = MOVE[key(MOVE, a.movement)];
	const light = a.keyLight ?? {};
	const angle = normalizeAngle({ ...DEFAULT_SCENE_ANGLE, ...(horiz ? { azimuthDeg: horiz[1] } : {}), ...(height ? { elevationDeg: height[1] } : {}),
		...(size ? { distance: size[1], fovDeg: size[2] } : {}), ...(lens?.[1] ? { fovDeg: lens[1] } : {}) });
	const camera = [horiz?.[0], height?.[0], size?.[0]].filter(Boolean).join(" ");
	const lightText = [LDIR[key(LDIR, light.direction)], light.softness === "hard" ? "하드" : light.softness === "soft" ? "소프트" : "", light.colorTemp === "warm" ? "따뜻한 색" : light.colorTemp === "cool" ? "차가운 색" : ""].filter(Boolean).join(" ");
	const text = [camera, lens ? `렌즈: ${lens[0]}` : "", move ? `움직임: ${move}` : "", lightText ? `조명: ${lightText}` : "", a.mood ? `분위기: ${a.mood}` : ""].filter(Boolean).join(" · ");
	return { angle, text, size: size?.[0] ?? "", lightingPreset: lightingPresetFor(light, a.mood) };
}

/** Closest stage lighting recipe (stage.applyLighting) for a key light. */
export function lightingPresetFor(light = {}, mood = "") {
	const m = String(mood).toLowerCase();
	if (/night|밤/.test(m)) return "night";
	if (/dusk|sunset|노을|황혼/.test(m)) return "dusk";
	if (/golden|골든/.test(m)) return "golden";
	if (/interior|indoor|실내|tungsten/.test(m)) return "interior";
	if (light.direction === "back" && light.colorTemp === "warm") return "golden";
	if (light.softness === "soft" && light.colorTemp !== "warm") return "overcast";
	if (light.colorTemp === "warm") return "interior";
	if (light.colorTemp === "cool" && light.softness === "hard") return "night";
	return light.softness === "hard" ? "day" : "studio";
}

export const LIGHTING_LABEL_KO = { studio: "스튜디오", day: "낮", overcast: "흐린 날", golden: "골든아워", dusk: "황혼", night: "밤", interior: "실내 텅스텐", stage: "무대" };

// ---------------------------------------------------------------- browser sampling
function signature(ctx, w, h) {
	const data = ctx.getImageData(0, 0, w, h).data;
	const out = new Uint8Array((data.length / 4) * 3);
	let luma = 0, warmth = 0;
	for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
		out[j] = data[i]; out[j + 1] = data[i + 1]; out[j + 2] = data[i + 2];
		luma += (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
		warmth += (data[i] - data[i + 2]) / 255;
	}
	const n = data.length / 4;
	return { sig: out, luma: luma / n, warmth: warmth / n };
}

async function openVideo(url) {
	const v = document.createElement("video");
	v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
	await once(v, "loadeddata", 15000, `영상을 불러오지 못했어요. ${CODEC_HINT}`);
	return v;
}
async function seek(v, t) {
	if (Math.abs(v.currentTime - t) < 1e-3) return;
	v.currentTime = t;
	await once(v, "seeked", 4000, "영상 위치 이동이 멈췄어요.").catch(() => {});
}

/**
 * Sample the whole video at a few frames per second on a tiny canvas, find
 * cuts, and describe each shot heuristically. onProgress(0..1).
 */
export async function analyzeCuts(item, { onProgress = () => {}, signal } = {}) {
	const v = await openVideo(item.url);
	try {
		const duration = item.duration || v.duration || 0;
		const step = Math.max(1 / 8, duration / 1200);
		const w = 32, h = 18, canvas = document.createElement("canvas");
		canvas.width = w; canvas.height = h;
		const ctx = canvas.getContext("2d", { willReadFrequently: true });
		const times = [], diffs = [], stats = [];
		let prev = null;
		for (let t = 0; t < duration; t += step) {
			if (signal?.aborted) throw new Error("취소했어요.");
			await seek(v, Math.min(t, Math.max(0, duration - 0.04)));
			ctx.drawImage(v, 0, 0, w, h);
			const { sig, luma, warmth } = signature(ctx, w, h);
			times.push(t); diffs.push(prev ? frameDifference(prev, sig) : 0); stats.push({ luma, warmth }); prev = sig;
			if (times.length % 8 === 0) onProgress(t / duration);
		}
		const cuts = detectCuts(diffs, times);
		const shots = cutsToRanges(cuts, duration).map((range) => {
			const idx = times.map((t, i) => (t >= range.start && t < range.end ? i : -1)).filter((i) => i >= 0);
			const avg = (f) => idx.length ? idx.reduce((sum, i) => sum + f(i), 0) / idx.length : 0;
			const motion = idx.length > 1 ? avg((i) => (times[i] > range.start + step ? diffs[i] : 0)) : 0;
			return { ...range, heuristic: heuristicNotes({ luma: avg((i) => stats[i].luma), warmth: avg((i) => stats[i].warmth), motion }), text: "", angle: null, lightingPreset: null };
		});
		onProgress(1);
		return { cuts, shots };
	} finally { v.removeAttribute("src"); v.load(); }
}

/** JPEG data URLs of one frame per shot (the shot's middle), max 512 px. */
export async function shotKeyframes(item, shots, maxSide = 512) {
	if (item.kind === "image") return [await imageToDataUrl(item.url, maxSide)];
	const v = await openVideo(item.url);
	try {
		const scale = Math.min(1, maxSide / Math.max(v.videoWidth, v.videoHeight));
		const canvas = document.createElement("canvas");
		canvas.width = Math.round(v.videoWidth * scale); canvas.height = Math.round(v.videoHeight * scale);
		const ctx = canvas.getContext("2d");
		const out = [];
		for (const shot of shots) { await seek(v, (shot.start + shot.end) / 2); ctx.drawImage(v, 0, 0, canvas.width, canvas.height); out.push(canvas.toDataURL("image/jpeg", 0.8)); }
		return out;
	} finally { v.removeAttribute("src"); v.load(); }
}
async function imageToDataUrl(url, maxSide) {
	const img = new Image(); img.src = url; await img.decode();
	const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
	const canvas = document.createElement("canvas");
	canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
	canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
	return canvas.toDataURL("image/jpeg", 0.8);
}

export const VISION_HELP_KO = "지금 연결된 모델은 이미지를 볼 수 없어요(텍스트 전용). 무료 로컬 비전 모델을 쓰려면 PowerShell에서 `ollama pull qwen2.5vl:3b` (빠름) 또는 `ollama pull qwen2.5vl:7b` (정확, 느림)을 실행한 뒤, 에이전트 패널 > 모델 연결 > 로컬 모델에서 모델 이름에 qwen2.5vl:3b 를 추가하고 선택하세요.";

/** Ask the agent server's selected model to analyse keyframes. */
export async function requestVisionAnalysis({ model, images, fetchImpl = globalThis.fetch }) {
	const response = await fetchImpl("/agent/vision", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin",
		body: JSON.stringify({ model, prompt: ANALYSIS_PROMPT, images }) });
	const body = await response.json().catch(() => ({}));
	if (response.status === 422 && body?.error?.code === "TEXT_ONLY") { const e = new Error(VISION_HELP_KO); e.textOnly = true; throw e; }
	if (response.status === 404 || response.status === 502 && !body?.error) throw new Error("에이전트 서버가 실행 중이 아니에요. CozyClay를 npm run dev 로 실행했는지 확인해 주세요.");
	if (!response.ok) throw new Error(`분석 요청 실패: ${body?.error?.message ?? response.status}`);
	const shots = parseAnalysis(body.text);
	if (!shots?.length) throw new Error("모델이 JSON 형식으로 답하지 않았어요. 다시 시도하거나 더 큰 모델(qwen2.5vl:7b)을 써 보세요.");
	return shots;
}
