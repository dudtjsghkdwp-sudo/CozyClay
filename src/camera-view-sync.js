// Viewport camera <-> per-scene angle sync. Pure helpers plus a tiny window
// event bus, so the 3D viewport (FlyControls) and the "장면별 카메라 각도"
// panel stay in step without threading props through the app shell.

const CAMERA_VIEW_EVENT = "cozyclay:camera-view";
/** Pixels a plain left press must travel before it becomes an orbit, so a
 * click still selects and a gizmo press is never mistaken for navigation. */
export const LEFT_ORBIT_THRESHOLD_PX = 4;

export function leftOrbitShouldStart(start, x, y, threshold = LEFT_ORBIT_THRESHOLD_PX) {
	return Boolean(start) && Math.hypot(x - start.x, y - start.y) >= threshold;
}

/** The framing shape a camera key stores, from a live camera. */
export function cameraViewFraming(camera) {
	const p = camera?.position;
	if (!p || ![p.x, p.y, p.z].every(Number.isFinite)) return null;
	camera.updateMatrixWorld?.();
	const e = camera.matrixWorld?.elements;
	// A camera looks down its local -Z: the third matrix column, negated.
	const dir = e ? { x: -e[8], y: -e[9], z: -e[10] } : null;
	return { pos: { x: p.x, y: p.y, z: p.z }, ...(dir && [dir.x, dir.y, dir.z].every(Number.isFinite) ? { dir } : {}), fovDeg: Number.isFinite(camera.fov) ? camera.fov : undefined };
}

/** The exact framing (shot.frame) that reproduces a viewport view as seen,
 * pan included: the look direction carried out to the subject's distance. */
export function exactFromView(framing, pivot, focalMm) {
	const { pos, dir } = framing ?? {};
	if (!pos) return null;
	const reach = Math.max(0.5, Math.hypot(pivot.x - pos.x, pivot.y - pos.y, pivot.z - pos.z));
	const length = dir ? Math.hypot(dir.x, dir.y, dir.z) : 0;
	const lookAt = length > 1e-6 ? { x: pos.x + dir.x / length * reach, y: pos.y + dir.y / length * reach, z: pos.z + dir.z / length * reach } : { ...pivot };
	return { position: { ...pos }, lookAt, focalMm };
}

export function emitCameraView(camera, final = false, target = globalThis.window) {
	const framing = cameraViewFraming(camera);
	if (!framing || typeof target?.dispatchEvent !== "function" || typeof CustomEvent !== "function") return;
	target.dispatchEvent(new CustomEvent(CAMERA_VIEW_EVENT, { detail: { framing, final } }));
}

export function onCameraView(listener, target = globalThis.window) {
	if (typeof target?.addEventListener !== "function") return () => {};
	const handler = (event) => listener(event.detail);
	target.addEventListener(CAMERA_VIEW_EVENT, handler);
	return () => target.removeEventListener(CAMERA_VIEW_EVENT, handler);
}
