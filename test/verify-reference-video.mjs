import assert from "node:assert/strict";
import { analysisToShot, cutsToRanges, detectCuts, frameDifference, heuristicNotes, lightingPresetFor, parseAnalysis, rangesToSegments } from "../src/reference-video.js";

// cuts: spikes well above the local level split shots; a slow pan does not
const times = Array.from({ length: 80 }, (_, i) => i / 8);
const diffs = times.map((t, i) => (i === 0 ? 0 : i === 24 || i === 56 ? 0.4 : 0.01 + (i > 30 && i < 50 ? 0.03 : 0)));
assert.deepEqual(detectCuts(diffs, times), [3, 7]);
assert.deepEqual(detectCuts(times.map(() => 0.05), times), [], "steady motion is not a cut");
const dance = times.map((t, i) => (i === 0 ? 0 : i === 40 ? 0.29 : 0.09 + 0.04 * Math.sin(i * 1.7)));
assert.deepEqual(detectCuts(dance, times), [5], "fast dancing stays one shot; the spike is a cut");
assert.deepEqual(detectCuts(dance.map((v, i) => (i === 40 ? 0.12 : v)), times), [], "a weak bump is not a cut at normal sensitivity");
assert.deepEqual(cutsToRanges([3, 7], 10), [{ start: 0, end: 3 }, { start: 3, end: 7 }, { start: 7, end: 10 }]);
assert.equal(frameDifference(new Uint8Array([0, 0, 0]), new Uint8Array([255, 255, 255])), 1);

// segments carry the per-shot angle from editable Korean text
const segs = rangesToSegments([{ start: 0, end: 3, text: "측면 로우 앵글 클로즈업" }, { start: 3, end: 7 }], 24);
assert.deepEqual([segs[0].startFrame, segs[0].endFrame, segs[1].startFrame, segs[1].endFrame], [0, 71, 72, 167]);
assert.equal(segs[0].angle.azimuthDeg, 90); assert.equal(segs[0].angle.elevationDeg, -20); assert.equal(segs[0].angle.distance, 1.2);
assert.match(segs[0].label, /참고 컷 1/);

// model replies: fenced JSON, structured → angle, Korean text, lighting preset
const reply = "```json\n{\"shots\":[{\"shotSize\":\"close-up\",\"cameraHeight\":\"low\",\"horizontal\":\"side\",\"lens\":\"tele\",\"movement\":\"dolly in\",\"keyLight\":{\"direction\":\"back\",\"softness\":\"soft\",\"colorTemp\":\"warm\"},\"mood\":\"sunset\"}]}\n```";
const [a] = parseAnalysis(reply);
const shot = analysisToShot(a);
assert.deepEqual(shot.angle, { azimuthDeg: 90, elevationDeg: -20, distance: 1.2, fovDeg: 20 });
assert.match(shot.text, /측면 로우 앵글 클로즈업/); assert.match(shot.text, /돌리 인/); assert.match(shot.text, /역광/);
assert.equal(shot.lightingPreset, "dusk");
// the Korean text round-trips through the deterministic parser to the same orbit
assert.equal(rangesToSegments([{ start: 0, end: 1, text: shot.text }], 24)[0].angle.elevationDeg, -20);
assert.equal(parseAnalysis("no json here"), null);
assert.equal(lightingPresetFor({ softness: "soft", colorTemp: "cool" }), "overcast");
assert.match(heuristicNotes({ luma: 0.1, warmth: 0.1, motion: 0 }), /어두운.*따뜻한.*고정/);
console.log("PASS reference video: cuts, segments, analysis mapping");
