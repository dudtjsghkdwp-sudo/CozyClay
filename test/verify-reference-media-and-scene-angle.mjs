#!/usr/bin/env node
// Reference attachments accept every image and video format, and each timeline
// shot owns its own camera angle that round-trips through its framing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REFERENCE_ACCEPT, isPlainStill, referenceKind, referenceMimeType } from "../src/reference-media.js";
import { angleToExactFraming, framingToAngle, normalizeAngle, describeAngle } from "../src/shell/scene-camera-angle.js";
import { attachmentFilesFromTransfer } from "../src/workflow/attachment-image.js";

const f = (name, type = "") => ({ name, type });
for (const ext of ["mp4", "mov", "webm", "avi", "mkv", "m4v", "wmv", "mpg", "3gp", "ts"]) assert.equal(referenceKind(f(`clip.${ext}`)), "video", ext);
for (const ext of ["jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "heic", "heif", "avif", "svg", "ico"]) assert.equal(referenceKind(f(`pic.${ext.toUpperCase()}`)), "image", ext);
assert.equal(referenceKind(f("x.mkv", "application/octet-stream")), "video");
assert.equal(referenceKind(f("notes.txt", "text/plain")), null);
assert.equal(referenceMimeType(f("a.mov")), "video/quicktime");
assert.ok(isPlainStill(f("a.JPG")) && !isPlainStill(f("a.heic")) && !isPlainStill(f("a.gif", "image/gif")));
for (const token of ["image/*", "video/*", ".mp4", ".mov", ".mkv", ".heic", ".avif", ".tiff", ".svg"]) assert.ok(REFERENCE_ACCEPT.split(",").includes(token), token);
const { images } = attachmentFilesFromTransfer({ files: [f("a.mp4", "video/mp4"), f("b.heic"), f("c.png", "image/png"), f("d.txt", "text/plain")] });
assert.equal(images.length, 3);
console.log("PASS reference media accepts every image and video format");

const pickers = ["src/panels/ReferenceImageField.jsx", "src/panels/PoseImagePanel.jsx", "src/panels/SculptPanel.jsx", "src/workflow/WorkflowBuilder.jsx"];
for (const path of pickers) assert.ok(readFileSync(new URL(`../${path}`, import.meta.url), "utf8").includes("REFERENCE_ACCEPT"), path);
console.log("PASS reference pickers use the shared accept list");

const subject = { x: 1, z: -2, rot: 30, scale: 1 };
for (const angle of [{ azimuthDeg: 0, elevationDeg: 5, distance: 3.5, fovDeg: 40 }, { azimuthDeg: 135, elevationDeg: 40, distance: 6, fovDeg: 25 }, { azimuthDeg: -90, elevationDeg: -20, distance: 1.2, fovDeg: 70 }]) {
	const exact = angleToExactFraming(subject, angle);
	const back = framingToAngle(subject, { pos: exact.position, fovDeg: angle.fovDeg });
	assert.deepEqual(back, normalizeAngle(angle));
	assert.ok(exact.focalMm > 0);
}
assert.equal(framingToAngle(subject, null), null);
assert.equal(describeAngle({ azimuthDeg: 180, elevationDeg: 70, distance: 8 }), "뒷모습 · 탑뷰 · 와이드 샷");
const panel = readFileSync(new URL("../src/shell/SceneAngleControls.jsx", import.meta.url), "utf8");
assert.ok(panel.includes("action('shot.frame', { shotId: shot.id"));
console.log("PASS each shot stores and reloads its own camera angle");

// Viewport mouse orbit <-> per-scene sliders.
import { LEFT_ORBIT_THRESHOLD_PX, cameraViewFraming, emitCameraView, exactFromView, leftOrbitShouldStart, onCameraView } from "../src/camera-view-sync.js";
import { subjectPivot } from "../src/shell/scene-camera-angle.js";
assert.equal(leftOrbitShouldStart({ x: 10, y: 10 }, 12, 11), false, "a click wobble is not an orbit");
assert.equal(leftOrbitShouldStart({ x: 10, y: 10 }, 10 + LEFT_ORBIT_THRESHOLD_PX, 10), true);
assert.equal(leftOrbitShouldStart(null, 100, 100), false);
{
	// a camera 4 m in front of the subject, looking at its chest
	const pivot = subjectPivot(subject);
	const exact = angleToExactFraming(subject, { azimuthDeg: 60, elevationDeg: 20, distance: 4, fovDeg: 35 });
	const d = { x: pivot.x - exact.position.x, y: pivot.y - exact.position.y, z: pivot.z - exact.position.z };
	// three.js matrixWorld: column 2 is the camera's +Z (backwards)
	const elements = new Array(16).fill(0); elements[8] = -d.x; elements[9] = -d.y; elements[10] = -d.z;
	const camera = { position: exact.position, fov: 35, matrixWorld: { elements } };
	const framing = cameraViewFraming(camera);
	assert.deepEqual(framingToAngle(subject, framing), normalizeAngle({ azimuthDeg: 60, elevationDeg: 20, distance: 4, fovDeg: 35 }), "the sliders read the dragged view");
	const saved = exactFromView(framing, pivot, 50);
	for (const k of ["x", "y", "z"]) assert.ok(Math.abs(saved.lookAt[k] - pivot[k]) < 1e-9, "an un-panned view saves aimed at the subject");
	const target = new EventTarget(); const seen = [];
	globalThis.CustomEvent ??= class extends Event { constructor(type, init) { super(type); this.detail = init?.detail; } };
	const off = onCameraView((detail) => seen.push(detail), target);
	emitCameraView(camera, true, target); off(); emitCameraView(camera, false, target);
	assert.equal(seen.length, 1); assert.equal(seen[0].final, true);
}
const controls = readFileSync(new URL("../src/controls.jsx", import.meta.url), "utf8");
assert.ok(controls.includes("leftOrbit && e.button === 0 && !e.altKey"), "plain left orbit is opt-in");
assert.ok(readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8").includes("leftOrbit={lookThroughShot && !ikMode}"));
console.log("PASS viewport mouse orbit stays in sync with the per-scene angle");

// File > Open: every file is listed, then routed by type with a Korean reason.
import { openFileRoute, projectReadFailureMessage, unsupportedOpenMessage } from "../src/open-file-route.js";
import { readProjectDocument } from "../src/project.js";
assert.equal(openFileRoute(f("내 프로젝트.cclayproject")), "project");
assert.equal(openFileRoute(f("C:\\Users\\신영선\\a.JSON")), "project");
assert.equal(openFileRoute(f("clip.MP4", "video/mp4")), "video");
assert.equal(openFileRoute(f("shot.mkv")), "video");
assert.equal(openFileRoute(f("ref.heic")), "image");
assert.equal(openFileRoute(f("car.glb")), "mesh");
assert.equal(openFileRoute(f("notes.docx")), "unsupported");
for (const reason of ["corrupt", "not-a-project", "future", "scenes-invalid", "empty", "unreadable"]) assert.ok(projectReadFailureMessage(reason, "a.json").includes("a.json"));
assert.ok(unsupportedOpenMessage("notes.docx").includes(".docx"));
assert.equal(readProjectDocument(readFileSync(new URL("../public/scenes/korean-street.cclayproject", import.meta.url), "utf8")).ok, true, "the bundled street project opens");
const projectSource = readFileSync(new URL("../src/project.js", import.meta.url), "utf8");
assert.ok(projectSource.includes("excludeAcceptAllOption: false") && !projectSource.includes("input.accept = `${PROJECT_EXTENSION}"), "Open lists all files");
const commandSource = readFileSync(new URL("../src/commands/project.js", import.meta.url), "utf8");
assert.ok(commandSource.includes("result?.cancelled") && !commandSource.includes("check the project dialog"), "cancel is not a failure");
console.log("PASS File > Open lists all files and explains every failure");
