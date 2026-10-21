// AI-free camera command line: "0-5초 정면, 5-10초 측면 로우앵글, 10-15초 탑뷰"
// or "5초마다 여러 각도". A deterministic parser turns it into timeline shots,
// each holding its own per-scene camera angle (scene-camera-angle.js). Pure.
import { createShot } from "../cuts.js";
import { angleToExactFraming, describeAngle, normalizeAngle, DEFAULT_SCENE_ANGLE } from "./scene-camera-angle.js";

// Order matters: longer / more specific words first.
const KEYWORDS = [
	[/(뒤|후면|rear|back)\s*3\s*\/\s*4/i, { azimuthDeg: 135 }],
	[/(앞\s*)?3\s*\/\s*4|쓰리쿼터|three[-\s]?quarter|3q/i, { azimuthDeg: 45 }],
	[/정면|앞모습|front/i, { azimuthDeg: 0 }],
	[/오른쪽\s*측면|우측면|right\s*side/i, { azimuthDeg: -90 }],
	[/측면|옆모습|좌측면|왼쪽\s*측면|side|profile/i, { azimuthDeg: 90 }],
	[/후면|뒷모습|뒤|back|rear/i, { azimuthDeg: 180 }],
	[/로우\s*앵글|로우|아래에서|low/i, { elevationDeg: -20 }],
	[/하이\s*앵글|하이|위에서|high/i, { elevationDeg: 40 }],
	[/탑\s*뷰|부감|탑|top|overhead|bird/i, { elevationDeg: 80 }],
	[/아이\s*레벨|눈높이|eye/i, { elevationDeg: 5 }],
	[/익스트림\s*클로즈업|extreme\s*close/i, { distance: 0.8, fovDeg: 30 }],
	[/클로즈\s*업|클로즈|close/i, { distance: 1.2, fovDeg: 35 }],
	[/미디엄|바스트|medium/i, { distance: 2.2 }],
	[/풀\s*샷|와이드|전신|wide|full/i, { distance: 6, fovDeg: 45 }],
];
const NUMBERS = [
	[/(?:거리|distance)\s*[:=]?\s*(-?\d+(?:\.\d+)?)\s*(?:m|미터)?/i, "distance"],
	[/(?:높이|고도|elevation|pitch)\s*[:=]?\s*(-?\d+(?:\.\d+)?)\s*(?:°|도)?/i, "elevationDeg"],
	[/(?:회전|방위|azimuth|yaw)\s*[:=]?\s*(-?\d+(?:\.\d+)?)\s*(?:°|도)?/i, "azimuthDeg"],
	[/(?:화각|fov)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:°|도)?/i, "fovDeg"],
];
/** The angles "여러 각도" cycles through. */
export const CYCLE_ANGLES = Object.freeze([
	{ label: "정면", angle: { azimuthDeg: 0, elevationDeg: 5, distance: 3.5 } },
	{ label: "앞 3/4", angle: { azimuthDeg: 45, elevationDeg: 10, distance: 3 } },
	{ label: "측면", angle: { azimuthDeg: 90, elevationDeg: 3, distance: 3.5 } },
	{ label: "로우 앵글", angle: { azimuthDeg: 20, elevationDeg: -20, distance: 2.5 } },
	{ label: "뒤 3/4", angle: { azimuthDeg: 150, elevationDeg: 10, distance: 3.5 } },
	{ label: "하이 앵글", angle: { azimuthDeg: -45, elevationDeg: 40, distance: 4 } },
	{ label: "클로즈업", angle: { azimuthDeg: 10, elevationDeg: 5, distance: 1.2, fovDeg: 35 } },
	{ label: "탑뷰", angle: { azimuthDeg: 0, elevationDeg: 80, distance: 6 } },
]);

export const COMMAND_HELP = [
	"0-5초 정면, 5-10초 측면 로우앵글, 10-15초 탑뷰",
	"0~3초 클로즈업 / 3~8초 풀샷 하이앵글",
	"0-48f 정면 거리 2, 48-96f 회전 135 높이 20",
	"5초마다 여러 각도",
].join("\n");

const NUM = "(\\d+(?:\\.\\d+)?)";
const RANGE = new RegExp(`^\\s*${NUM}\\s*(초|s|sec|f|프레임|frames?)?\\s*(?:-|~|–|부터|to)\\s*${NUM}\\s*(초|s|sec|f|프레임|frames?)?\\s*(?:까지)?`, "i");
const EVERY = new RegExp(`${NUM}\\s*(초|s|sec|f|프레임|frames?)\\s*(?:마다|씩|간격|each)|every\\s*${NUM}\\s*(s|sec|seconds?|f|frames?)`, "i");

const isFrames = (unit) => /^(f|프레임|frames?)$/i.test(unit ?? "");
const toFrame = (value, unit, fps) => Math.round(Number(value) * (isFrames(unit) ? 1 : fps));

/** The angle words in one phrase, or null when it names none. */
export function parseAnglePhrase(text) {
	let angle = {};
	let rest = String(text);
	let hit = false;
	for (const [re, key] of NUMBERS) {
		const m = rest.match(re);
		if (m) { angle[key] = Number(m[1]); rest = rest.replace(m[0], " "); hit = true; }
	}
	for (const [re, patch] of KEYWORDS) {
		if (re.test(rest)) {
			// a later keyword never overrides a field an earlier, more specific one set
			for (const [k, v] of Object.entries(patch)) if (!(k in angle)) angle[k] = v;
			rest = rest.replace(re, " ");
			hit = true;
		}
	}
	if (!hit) return null;
	return { angle: normalizeAngle({ ...DEFAULT_SCENE_ANGLE, ...angle }), leftover: rest.replace(/[\s,.;·/]+/g, " ").trim() };
}

/**
 * Parse the whole command. Lines and commas separate phrases.
 * Returns { segments: [{ startFrame, endFrame, angle, label, source }], errors: [{ text, message }] }.
 * endFrame is inclusive, matching shots.
 */
export function parseCameraCommand(text, { fps = 24, frameCount = 240 } = {}) {
	const segments = [];
	const errors = [];
	const phrases = String(text ?? "").split(/[\n,;]+|\s\/\s/).map((p) => p.trim()).filter(Boolean);
	if (!phrases.length) return { segments, errors: [{ text: "", message: "명령을 입력해 주세요. 예: 0-5초 정면, 5-10초 측면" }] };
	for (const phrase of phrases) {
		const every = phrase.match(EVERY);
		if (every) {
			const step = toFrame(every[1] ?? every[3], every[2] ?? every[4], fps);
			if (step < 1) { errors.push({ text: phrase, message: "간격은 0보다 커야 해요." }); continue; }
			const custom = parseAnglePhrase(phrase.replace(every[0], " ").replace(/여러\s*각도|다양한\s*각도|various\s*angles?|angles?/gi, " "));
			const cycle = CYCLE_ANGLES;
			for (let start = 0, i = 0; start < frameCount; start += step, i += 1) {
				const pick = cycle[i % cycle.length];
				const angle = normalizeAngle({ ...DEFAULT_SCENE_ANGLE, ...pick.angle, ...(custom ? { fovDeg: custom.angle.fovDeg } : {}) });
				segments.push({ startFrame: start, endFrame: Math.min(frameCount, start + step) - 1, angle, label: pick.label, source: phrase });
			}
			continue;
		}
		const range = phrase.match(RANGE);
		if (!range) { errors.push({ text: phrase, message: "시간 구간을 찾지 못했어요. '0-5초 정면'처럼 시작-끝 시간을 앞에 적어 주세요." }); continue; }
		const unitA = range[2] ?? range[4];
		const unitB = range[4] ?? range[2];
		const startFrame = toFrame(range[1], unitA, fps);
		const endExclusive = toFrame(range[3], unitB, fps);
		if (endExclusive <= startFrame) { errors.push({ text: phrase, message: "끝 시간이 시작 시간보다 커야 해요." }); continue; }
		const parsed = parseAnglePhrase(phrase.slice(range[0].length));
		if (!parsed) { errors.push({ text: phrase, message: "카메라 각도 단어를 찾지 못했어요. 정면·측면·후면·3/4·로우·하이·탑뷰·클로즈업·풀샷 또는 거리/높이/회전 숫자를 써 주세요." }); continue; }
		segments.push({ startFrame, endFrame: endExclusive - 1, angle: parsed.angle, label: describeAngle(parsed.angle), source: phrase });
	}
	segments.sort((a, b) => a.startFrame - b.startFrame);
	for (let i = 1; i < segments.length; i += 1) {
		if (segments[i].startFrame <= segments[i - 1].endFrame) {
			errors.push({ text: segments[i].source, message: `구간이 앞 구간(${segments[i - 1].source})과 겹쳐요.` });
		}
	}
	return { segments, errors };
}

/** yaw/pitch (radians) that look from position at target; mirrors aimAt(). */
function aim(position, target) {
	const dx = target.x - position.x, dy = target.y - position.y, dz = target.z - position.z;
	return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.max(Math.hypot(dx, dz), 1e-6)) };
}

/** A camera key framing ({ pos, yaw, pitch, fovDeg }) for an angle around a subject. */
function angleToKeyFraming(subject, angle) {
	const value = normalizeAngle(angle);
	const exact = angleToExactFraming(subject, value);
	return { pos: exact.position, ...aim(exact.position, exact.lookAt), fovDeg: value.fovDeg };
}

/**
 * The full shot list after applying segments: existing shots that overlap a
 * new segment are removed, the rest are kept, and one held shot per segment
 * is added. Returned sorted, ready for a single shot.replace (one undo).
 */
export function shotsFromSegments(existing, segments, subject, make = createShot) {
	const kept = (existing ?? []).filter((shot) => !segments.some((seg) => shot.startFrame <= seg.endFrame && seg.startFrame <= shot.endFrame));
	const added = segments.map((seg, index) => make(`${index + 1}. ${seg.label}`, seg.startFrame, seg.endFrame, [{ frame: seg.startFrame, framing: angleToKeyFraming(subject, seg.angle) }]));
	return [...kept, ...added].sort((a, b) => a.startFrame - b.startFrame);
}

export function segmentsEndFrame(segments) {
	return segments.reduce((max, seg) => Math.max(max, seg.endFrame + 1), 0);
}
