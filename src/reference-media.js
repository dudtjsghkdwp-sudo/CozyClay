// Reference media (pictures and videos) the operator can attach as a
// reference. Kept free of React. Every downstream consumer (scene assets, the
// agent turn envelope, image models) takes a still PNG/JPEG/WebP, so any other
// picture format is decoded and re-encoded here, and a video contributes one
// still frame. The original file is never uploaded anywhere by this module.

const REFERENCE_IMAGE_EXTENSIONS = Object.freeze([
	"jpg", "jpeg", "jpe", "jfif", "pjpeg", "pjp", "png", "apng", "webp", "gif", "bmp", "dib",
	"tif", "tiff", "heic", "heif", "avif", "svg", "svgz", "ico", "cur", "jxl",
]);
const REFERENCE_VIDEO_EXTENSIONS = Object.freeze([
	"mp4", "m4v", "mov", "qt", "webm", "mkv", "avi", "wmv", "flv", "f4v", "mpg", "mpeg", "mpe",
	"m2v", "m2ts", "mts", "ts", "3gp", "3g2", "ogv", "ogg", "mxf", "asf", "vob", "divx",
]);
/** `accept` for a reference picker: the MIME families plus explicit
 * extensions, because Windows and some browsers report no MIME for
 * .mkv/.heic/.avi and would otherwise hide those files in the picker. */
export const REFERENCE_ACCEPT = ["image/*", "video/*",
	...REFERENCE_IMAGE_EXTENSIONS.map((ext) => `.${ext}`),
	...REFERENCE_VIDEO_EXTENSIONS.map((ext) => `.${ext}`)].join(",");


const STILL_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const EXTENSION_MIME = {
	jpg: "image/jpeg", jpeg: "image/jpeg", jpe: "image/jpeg", jfif: "image/jpeg", pjpeg: "image/jpeg", pjp: "image/jpeg",
	png: "image/png", apng: "image/apng", webp: "image/webp", gif: "image/gif", bmp: "image/bmp", dib: "image/bmp",
	tif: "image/tiff", tiff: "image/tiff", heic: "image/heic", heif: "image/heif", avif: "image/avif",
	svg: "image/svg+xml", svgz: "image/svg+xml", ico: "image/x-icon", cur: "image/x-icon", jxl: "image/jxl",
	mp4: "video/mp4", m4v: "video/x-m4v", mov: "video/quicktime", qt: "video/quicktime", webm: "video/webm",
	mkv: "video/x-matroska", avi: "video/x-msvideo", wmv: "video/x-ms-wmv", flv: "video/x-flv", f4v: "video/mp4",
	mpg: "video/mpeg", mpeg: "video/mpeg", mpe: "video/mpeg", m2v: "video/mpeg", m2ts: "video/mp2t", mts: "video/mp2t",
	ts: "video/mp2t", "3gp": "video/3gpp", "3g2": "video/3gpp2", ogv: "video/ogg", ogg: "video/ogg", mxf: "application/mxf",
	asf: "video/x-ms-asf", vob: "video/dvd", divx: "video/x-msvideo",
};

function fileExtension(file) {
	return String(file?.name ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
}

/** "image", "video" or null. The extension decides when the MIME is empty or
 * generic (application/octet-stream), which is common for .mkv/.heic. */
export function referenceKind(file) {
	const type = String(file?.type ?? "").toLowerCase();
	if (type.startsWith("image/")) return "image";
	if (type.startsWith("video/")) return "video";
	const ext = fileExtension(file);
	if (REFERENCE_IMAGE_EXTENSIONS.includes(ext)) return "image";
	if (REFERENCE_VIDEO_EXTENSIONS.includes(ext)) return "video";
	return null;
}

/** The best MIME for a file: its declared one, else one from its extension. */
export function referenceMimeType(file) {
	const type = String(file?.type ?? "").toLowerCase();
	if (type && type !== "application/octet-stream") return type;
	return EXTENSION_MIME[fileExtension(file)] ?? type;
}

export function isReferenceMedia(file) {
	return referenceKind(file) !== null;
}

/** Whether a file is already a still the pipeline takes verbatim. */
export function isPlainStill(file) {
	return STILL_TYPES.has(referenceMimeType(file));
}

function stillFileName(name, type) {
	const base = String(name || "reference").replace(/\.[^.]*$/, "") || "reference";
	return `${base}.${type === "image/jpeg" ? "jpg" : "png"}`;
}

function canvasToBlob(canvas, type, quality) {
	return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("could not encode the frame")), type, quality));
}

function drawToFile(source, width, height, name, type) {
	if (!width || !height) throw new Error("that file has no usable size");
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	canvas.getContext("2d").drawImage(source, 0, 0, width, height);
	return canvasToBlob(canvas, type, type === "image/jpeg" ? 0.92 : undefined)
		.then((blob) => new File([blob], stillFileName(name, type), { type }));
}

async function decodePicture(file) {
	// createImageBitmap covers png/jpeg/webp/gif/bmp/avif/ico; an <img> also
	// covers SVG and whatever else the browser can show (HEIC/TIFF on Safari).
	try {
		if (typeof createImageBitmap === "function") {
			const bitmap = await createImageBitmap(file);
			return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() };
		}
	} catch { /* fall through to <img> */ }
	const url = URL.createObjectURL(file);
	try {
		const img = new Image();
		img.decoding = "async";
		img.src = url;
		await img.decode();
		const width = img.naturalWidth || 1024;
		const height = img.naturalHeight || 1024;
		return { source: img, width, height, close: () => URL.revokeObjectURL(url) };
	} catch {
		URL.revokeObjectURL(url);
		const ext = fileExtension(file);
		throw new Error(["heic", "heif", "tif", "tiff", "jxl"].includes(ext)
			? `this browser cannot decode .${ext} — convert it to JPEG/PNG, or open CozyClay in Safari`
			: "could not decode that image");
	}
}

const VIDEO_LOAD_TIMEOUT_MS = 15000;
const VIDEO_SEEK_TIMEOUT_MS = 4000;

/** Resolve on the first of `events`, reject on error, or settle on timeout. */
function waitFor(video, events, ms, onTimeout) {
	return new Promise((resolve, reject) => {
		const done = (fn, value) => { clearTimeout(timer); for (const name of [...events, "error"]) video.removeEventListener(name, handlers[name]); fn(value); };
		const handlers = {};
		for (const name of events) { handlers[name] = () => done(resolve, name); video.addEventListener(name, handlers[name]); }
		handlers.error = () => done(reject, video.error);
		video.addEventListener("error", handlers.error);
		const timer = setTimeout(() => (onTimeout === "resolve" ? done(resolve, "timeout") : done(reject, Object.assign(new Error("timeout"), { name: "TimeoutError" }))), ms);
	});
}

function videoErrorMessage(file, failure) {
	const ext = fileExtension(file) || "video";
	if (failure?.name === "TimeoutError") return `영상을 불러오는 데 너무 오래 걸려요 (.${ext}). 파일이 크거나 이 브라우저가 해당 코덱(예: HEVC/H.265 .mov)을 재생하지 못할 수 있어요. MP4(H.264)나 WebM으로 변환하거나, 영상의 한 장면을 이미지로 저장해 첨부해 주세요.`;
	return `이 브라우저가 .${ext} 영상을 재생하지 못해요 (코덱 미지원일 수 있어요, 예: HEVC/H.265 .mov·.mkv). MP4(H.264)나 WebM으로 변환하거나, 영상의 한 장면을 이미지로 저장해 첨부해 주세요.`;
}

/** One still frame from a video, a little after the start so a black lead-in
 * is skipped; frame 0 when seeking stalls. Never hangs: every wait has a
 * timeout and every failure carries a Korean reason. */
async function videoFrameToFile(file, { at = 0.1 } = {}) {
	const url = URL.createObjectURL(file);
	const video = document.createElement("video");
	video.muted = true;
	video.defaultMuted = true;
	video.playsInline = true;
	video.setAttribute("playsinline", "");
	video.preload = "auto";
	video.crossOrigin = "anonymous";
	// Off-screen but attached: some Chromium builds never decode a frame for a detached element.
	video.style.cssText = "position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none";
	document.body?.appendChild(video);
	try {
		try {
			video.src = url;
			video.load();
			await waitFor(video, ["loadeddata"], VIDEO_LOAD_TIMEOUT_MS);
		} catch (failure) {
			throw new Error(videoErrorMessage(file, failure));
		}
		if (!video.videoWidth || !video.videoHeight) throw new Error(`영상에 화면(비디오 트랙)이 없어요 — 소리만 있는 파일이거나 코덱을 지원하지 않아요 (.${fileExtension(file) || "video"}).`);
		const duration = Number.isFinite(video.duration) ? video.duration : 0;
		const target = Math.min(Math.max(0, duration * at), 1, Math.max(0, duration - 0.05));
		if (target > 0) {
			video.currentTime = target;
			// A stalled seek falls back to whatever frame is decoded (the first).
			const result = await waitFor(video, ["seeked"], VIDEO_SEEK_TIMEOUT_MS, "resolve").catch(() => "error");
			if (result !== "seeked") { try { video.currentTime = 0; await waitFor(video, ["seeked"], VIDEO_SEEK_TIMEOUT_MS, "resolve"); } catch { /* keep the decoded frame */ } }
		}
		return await drawToFile(video, video.videoWidth, video.videoHeight, file.name, "image/jpeg");
	} finally {
		video.removeAttribute("src");
		video.load?.();
		video.remove();
		URL.revokeObjectURL(url);
	}
}

/**
 * Any accepted reference file as a PNG/JPEG/WebP File the rest of the studio
 * understands. A plain still is returned untouched (no generation loss).
 */
export async function referenceFileToStill(file) {
	const kind = referenceKind(file);
	if (!kind) throw new Error("attach an image or a video file");
	if (kind === "video") return videoFrameToFile(file);
	if (isPlainStill(file)) {
		const type = referenceMimeType(file);
		return file.type === type ? file : new File([file], file.name, { type });
	}
	const picture = await decodePicture(file);
	try {
		return await drawToFile(picture.source, picture.width, picture.height, file.name, "image/png");
	} finally {
		picture.close();
	}
}
