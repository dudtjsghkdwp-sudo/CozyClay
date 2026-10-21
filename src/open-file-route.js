// What File > Open does with the file the operator picked. The dialog shows
// every file (Windows Chrome otherwise hides anything that is not
// *.cclayproject), so the choice is made here, by extension and MIME, with a
// specific message for everything that cannot be opened. Pure; no DOM.
import { ko } from "./locale.js";
import { referenceKind } from "./reference-media.js";

const PROJECT_EXTENSIONS = ["cclayproject", "json", "cozyclay"];
const MESH_EXTENSIONS = ["glb", "gltf", "obj", "fbx"];

const extensionOf = (name) => String(name ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";

/** "project" | "image" | "video" | "mesh" | "unsupported" */
export function openFileRoute(file) {
	const ext = extensionOf(file?.name);
	if (PROJECT_EXTENSIONS.includes(ext) || String(file?.type ?? "").toLowerCase() === "application/json") return "project";
	if (MESH_EXTENSIONS.includes(ext)) return "mesh";
	const kind = referenceKind(file);
	return kind ?? "unsupported";
}

/** A sentence for why a project file could not be read (readProjectDocument reasons). */
export function projectReadFailureMessage(reason, fileName = "") {
	const name = fileName ? `'${fileName}' ` : "";
	switch (reason) {
	case "corrupt": return ko(`Cannot open ${name}— the file is damaged or is not CozyClay project JSON.`, `${name}프로젝트를 열 수 없어요 — 파일이 손상됐거나 CozyClay 프로젝트(JSON) 형식이 아니에요.`);
	case "not-a-project": return ko(`Cannot open ${name}— it is JSON, but not a CozyClay project.`, `${name}프로젝트를 열 수 없어요 — JSON 파일이지만 CozyClay 프로젝트 파일이 아니에요.`);
	case "future": return ko(`Cannot open ${name}— it was saved by a newer CozyClay. Update the app and try again.`, `${name}프로젝트를 열 수 없어요 — 더 새로운 버전의 CozyClay에서 저장된 파일이에요. 앱을 업데이트한 뒤 다시 열어 주세요.`);
	case "scenes-invalid": return ko(`Cannot open ${name}— its scene data is invalid.`, `${name}프로젝트를 열 수 없어요 — 파일 안의 장면 데이터가 올바르지 않아요.`);
	case "empty": return ko(`Cannot open ${name}— the file is empty.`, `${name}프로젝트를 열 수 없어요 — 빈 파일이에요.`);
	case "unreadable": return ko(`Cannot read ${name}— the file may be open in another program, moved, or blocked from this browser.`, `${name}파일을 읽지 못했어요 — 다른 프로그램에서 사용 중이거나, 옮겨졌거나, 브라우저 접근이 막혔을 수 있어요.`);
	default: return ko(`Cannot open ${name}(${reason}).`, `${name}프로젝트를 열 수 없어요 (${reason}).`);
	}
}

export function unsupportedOpenMessage(fileName) {
	const ext = extensionOf(fileName);
	return ko(`'${fileName}' cannot be opened. Open accepts a CozyClay project (.cclayproject/.json), an image, a video or a 3D model (.glb/.obj/.fbx).`,
		`'${fileName}' 파일은 열 수 없어요${ext ? ` (.${ext})` : ""}. 열기에서는 CozyClay 프로젝트(.cclayproject/.json), 이미지, 영상, 3D 모델(.glb/.obj/.fbx)만 열 수 있어요.`);
}

/** Why reading the picked file threw, in words the operator can act on. */
export function openErrorMessage(err, fileName) {
	const what = fileName ? `'${fileName}' ` : "";
	const detail = err?.name === "NotAllowedError" || err?.name === "SecurityError"
		? ko("the browser blocked access to the file", "브라우저가 파일 접근을 막았어요")
		: err?.name === "NotReadableError" || err?.name === "NotFoundError"
			? ko("the file could not be read (in use, moved or deleted)", "파일을 읽을 수 없어요 (다른 프로그램에서 사용 중이거나 옮겨졌거나 삭제됨)")
			: (err?.message || String(err));
	return ko(`Could not open ${what}— ${detail}`, `${what}파일을 열지 못했어요 — ${detail}`);
}
