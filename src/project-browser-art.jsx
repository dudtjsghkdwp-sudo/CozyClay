// Start-screen art: the brand mark and the template thumbnail that fills both
// the card and the larger preview. Thumbnails are real studio renders, one per
// theme, made by tools/render-start-thumbs.mjs into public/thumbs/. A template
// without a render (a starter added since the last run) keeps the plain tile
// its wrapper already paints.
import { useState } from "react";
import { useUiTheme } from "./theme.js";

export function TemplateThumb({ id }) {
	const theme = useUiTheme();
	const src = id === "korean-street" ? "/thumbs/korean-street.png" : `/thumbs/${id}-${theme}.webp`;
	const [failed, setFailed] = useState(null);
	if (failed === src) return null;
	return <img className="v2-start-art" src={src} alt="" aria-hidden="true" draggable="false" decoding="async" onError={() => setFailed(src)} />;
}

export function BrandMark() {
	return <img className="v2-start-brand-mark" src="/icons/icon-192.png" alt="" aria-hidden="true" draggable="false" width="26" height="26" />;
}
