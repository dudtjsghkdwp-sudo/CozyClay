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
