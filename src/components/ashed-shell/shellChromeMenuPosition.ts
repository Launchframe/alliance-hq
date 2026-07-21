/** Aligns with Tailwind `sm` (640px). */
export const SHELL_CHROME_MOBILE_MAX_WIDTH_PX = 639;

const EDGE_PX = 16;

export type ShellChromeMenuRect = {
  top: number;
  left?: number;
  right?: number;
  width?: number;
  minWidth?: number;
};

export function readViewportWidth(): number {
  if (typeof window !== "undefined") {
    return window.innerWidth;
  }
  return 1024;
}

export function isShellChromeMobileViewport(
  width = readViewportWidth(),
): boolean {
  return width <= SHELL_CHROME_MOBILE_MAX_WIDTH_PX;
}

/**
 * Positions a top-chrome dropdown under its trigger.
 * On mobile: full viewport width (with edge inset), centered via left+right.
 * On desktop: right-aligned to the trigger.
 */
export function shellChromeMenuRectFromTrigger(
  trigger: DOMRect,
  options?: {
    desktopMinWidth?: number;
    desktopWidth?: number;
    gap?: number;
    viewportWidth?: number;
  },
): ShellChromeMenuRect {
  const gap = options?.gap ?? 8;
  const viewportWidth = options?.viewportWidth ?? readViewportWidth();
  const top = trigger.bottom + gap;

  if (isShellChromeMobileViewport(viewportWidth)) {
    return {
      top,
      left: EDGE_PX,
      right: EDGE_PX,
    };
  }

  return {
    top,
    right: viewportWidth - trigger.right,
    ...(options?.desktopMinWidth != null
      ? { minWidth: options.desktopMinWidth }
      : {}),
    ...(options?.desktopWidth != null ? { width: options.desktopWidth } : {}),
  };
}
