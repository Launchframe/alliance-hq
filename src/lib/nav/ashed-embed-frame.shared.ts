/**
 * Viewport-relative frame heights for Ashed iframes.
 *
 * HQ chrome (shell header + main padding) is roughly 8–10rem. Embed pages
 * with an HQ title card or week toolbar need a larger subtract. Prefer a tall
 * usable frame over leaving empty canvas below a short iframe.
 *
 * Use explicit `h-[…]` (not only `min-h` + `flex-1`): without a definite
 * height, iframes collapse to the browser default (~150px).
 */
export const ASHED_EMBED_FRAME_CLASS =
  "h-[max(24rem,calc(100dvh-10rem))]";

/** AshedEmbed desktop layout: title card + optional login hint above the iframe. */
export const ASHED_EMBED_FRAME_WITH_PAGE_CHROME_CLASS =
  "h-[max(24rem,calc(100dvh-10rem))] md:h-[max(28rem,calc(100dvh-16rem))]";
