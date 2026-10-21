// Starter scenes ship inside the build (public/scenes/<id>.cclayproject) and
// are referred to by id: `npx cozyclay --scene <id>`, `?scene=<id>` and the
// chooser's template cards. The build ships none today; an unknown id resolves
// to null, and the studio ignores it.

export const STARTER_SCENES = Object.freeze([
	{ id: "korean-street", name: "한국 길거리 프리비즈", blurb: "한국 거리 배경과 걷는 인물, 카메라 샷이 준비된 장면" },
]);

function starterSceneById(id) {
	return STARTER_SCENES.find((scene) => scene.id === id) ?? null;
}

/** `?scene=` accepts a starter id or a same-origin path. */
export function resolveSceneParam(value) {
	if (typeof value !== "string" || !value) return null;
	const starter = starterSceneById(value);
	if (starter) return `/scenes/${starter.id}.cclayproject`;
	if (value.startsWith("/") && !value.startsWith("//")) return value;
	return null;
}
