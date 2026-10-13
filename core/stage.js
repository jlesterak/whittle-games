// Fit a game's fixed design space (e.g. 1080x2316 portrait) into the game root, which already
// excludes the safe-area insets (core/style.css). Contain-fit, so nothing is ever cropped on
// tall-narrow phones, short browser viewports (address/tool bars) or landscape screens.
// `top` is headroom above design y=0 that must stay visible too: content drawn at negative y
// (Beadloom's feeder arms, Purl's picture frame) ends inside it instead of off-screen.
// Returns the scale (CSS px per design px) and where design (0, 0) lands, in CSS px.
export function fitStage(cssW, cssH, { W, H, top = 0 }) {
  const scale = Math.min(cssW / W, cssH / (H + top));
  return {
    scale,
    offX: (cssW - W * scale) / 2,
    offY: (cssH - (H + top) * scale) / 2 + top * scale,
  };
}

// Device pixels per CSS pixel for the canvas. Render at the display's native density so sprites
// stay crisp on hi-DPI phones (the old 1.25/scale cap rendered ~6% below native -> soft upscale).
// Keep a ceiling of 2 device px per design px so a tiny design space on a huge screen can't blow
// up the backing store; native DPR is well under that on real phones.
export const canvasDpr = (scale) => Math.min(globalThis.devicePixelRatio || 1, 2 / scale);
