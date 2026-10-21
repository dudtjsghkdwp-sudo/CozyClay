// Per-scene (per-shot) camera angle: an orbit around the subject expressed as
// azimuth / elevation / distance / vertical FOV, the same vocabulary the
// ai-camera-control page uses. Pure math, no React. The angle is not a second
// source of truth: it is written into the shot's own held camera framing
// (shot.frame exact), so preview, playback, MP4 export and video generation
// all use it, and it is read back from that framing when a shot is selected.

import { SUBJECT_HEIGHT_M, fovToFocalMm } from "../shot.js";

const DEG = Math.PI / 180;
export const ANGLE_LIMITS = Object.freeze({
	azimuthDeg: Object.freeze({ min: -180, max: 180, step: 5 }),
	elevationDeg: Object.freeze({ min: -30, max: 80, step: 1 }),
	distance: Object.freeze({ min: 0.6, max: 15, step: 0.1 }),
	fovDeg: Object.freeze({ min: 14, max: 90, step: 1 }),
});
export const DEFAULT_SCENE_ANGLE = Object.freeze({ azimuthDeg: 0, elevationDeg: 5, distance: 3.5, fovDeg: 40 });
export const ANGLE_PRESETS = Object.freeze([
	{ id: "front", label: "정면", angle: { azimuthDeg: 0, elevationDeg: 5 } },
	{ id: "front34", label: "앞 3/4", angle: { azimuthDeg: 45, elevationDeg: 8 } },
	{ id: "side", label: "측면", angle: { azimuthDeg: 90, elevationDeg: 3 } },
	{ id: "back", label: "뒷모습", angle: { azimuthDeg: 180, elevationDeg: 8 } },
	{ id: "low", label: "로우 앵글", angle: { elevationDeg: -20 } },
	{ id: "high", label: "하이 앵글", angle: { elevationDeg: 45 } },
	{ id: "top", label: "탑뷰", angle: { elevationDeg: 80 } },
]);

const clamp = (v, { min, max }) => Math.min(max, Math.max(min, v));
const wrapDeg = (v) => { const w = ((((v + 180) % 360) + 360) % 360) - 180; return w === -180 ? 180 : w; };

export function normalizeAngle(angle = {}) {
	const pick = (key) => Number.isFinite(Number(angle[key])) ? Number(angle[key]) : DEFAULT_SCENE_ANGLE[key];
	return {
		azimuthDeg: Math.round(wrapDeg(pick("azimuthDeg"))),
		elevationDeg: Math.round(clamp(pick("elevationDeg"), ANGLE_LIMITS.elevationDeg)),
		distance: Math.round(clamp(pick("distance"), ANGLE_LIMITS.distance) * 10) / 10,
		fovDeg: Math.round(clamp(pick("fovDeg"), ANGLE_LIMITS.fovDeg)),
	};
}

/** Where the camera looks: the subject's chest, scaled with the figure. */
export function subjectPivot(subject) {
	return { x: subject?.x ?? 0, y: SUBJECT_HEIGHT_M * (subject?.scale ?? 1) * 0.52, z: subject?.z ?? 0 };
}

/** Azimuth is measured from the subject's facing (0 = in front, 90 = their
 * left side, 180 = behind); rot is the character heading in degrees. */
export function angleToExactFraming(subject, angle) {
	const a = normalizeAngle(angle);
	const pivot = subjectPivot(subject);
	const heading = (subject?.rot ?? 0) + a.azimuthDeg;
	const horizontal = a.distance * Math.cos(a.elevationDeg * DEG);
	const position = {
		x: pivot.x + Math.sin(heading * DEG) * horizontal,
		y: Math.max(0.1, pivot.y + a.distance * Math.sin(a.elevationDeg * DEG)),
		z: pivot.z + Math.cos(heading * DEG) * horizontal,
	};
	return { position, lookAt: pivot, focalMm: Math.round(fovToFocalMm(a.fovDeg * DEG) * 10) / 10 };
}

/** The angle a stored camera key framing ({ pos, fovDeg }) shows, relative to
 * the subject, or null when the shot has no framing yet. */
export function framingToAngle(subject, framing) {
	const pos = framing?.pos;
	if (!pos || ![pos.x, pos.y, pos.z].every(Number.isFinite)) return null;
	const pivot = subjectPivot(subject);
	const dx = pos.x - pivot.x, dy = pos.y - pivot.y, dz = pos.z - pivot.z;
	const horizontal = Math.hypot(dx, dz);
	const distance = Math.hypot(horizontal, dy);
	if (distance < 1e-6) return null;
	return normalizeAngle({
		azimuthDeg: Math.atan2(dx, dz) / DEG - (subject?.rot ?? 0),
		elevationDeg: Math.atan2(dy, horizontal) / DEG,
		distance,
		fovDeg: Number.isFinite(framing.fovDeg) ? framing.fovDeg : DEFAULT_SCENE_ANGLE.fovDeg,
	});
}

/** Film-language summary for the UI and the shot caption. */
export function describeAngle(angle) {
	const a = normalizeAngle(angle);
	const az = Math.abs(a.azimuthDeg);
	const view = az <= 22 ? "정면" : az <= 67 ? "앞 3/4" : az <= 112 ? "측면" : az <= 157 ? "뒤 3/4" : "뒷모습";
	const level = a.elevationDeg <= -10 ? "로우 앵글" : a.elevationDeg >= 60 ? "탑뷰" : a.elevationDeg >= 20 ? "하이 앵글" : "아이 레벨";
	const size = a.distance < 1.4 ? "클로즈업" : a.distance < 2.6 ? "미디엄 샷" : a.distance < 5 ? "미디엄 와이드" : "와이드 샷";
	return `${view} · ${level} · ${size}`;
}
