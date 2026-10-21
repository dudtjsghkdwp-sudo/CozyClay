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

/** One still frame from a video, by default a little after the start so a
 * black lead-in frame is skipped. */
async function videoFrameToFile(file, { at = 0.1 } = {}) {
	const url = URL.createObjectURL(file);
	const video = document.createElement("video");
	video.muted = true;
	video.playsInline = true;
	video.preload = "auto";
	try {
		await new Promise((resolve, reject) => {
			video.onloadeddata = resolve;
			video.onerror = () => reject(new Error(`this browser cannot decode .${fileExtension(file) || "video"} — try MP4 (H.264) or WebM`));
			video.src = url;
		});
		const duration = Number.isFinite(video.duration) ? video.duration : 0;
		const target = Math.min(Math.max(0, duration * at), Math.max(0, duration - 0.05));
		if (target > 0) {
			await new Promise((resolve) => {
				video.onseeked = resolve;
				video.currentTime = target;
			});
		}
		return await drawToFile(video, video.videoWidth, video.videoHeight, file.name, "image/jpeg");
	} finally {
		video.removeAttribute("src");
		video.load?.();
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
