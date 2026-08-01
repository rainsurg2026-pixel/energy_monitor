/**
 * WCAG-AA-aware text-color selection for a given background hex. Every
 * chart/card/tooltip that paints text on a dynamic (data-driven) background
 * color must go through this - never hardcode black/white per component.
 */

export const WCAG_AA_CONTRAST_MINIMUM = 4.5;

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "");
  const full = normalized.length === 3 ? normalized.split("").map(c => c + c).join("") : normalized;
  const value = parseInt(full, 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function srgbChannelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance (0 = black, 1 = white). */
function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * srgbChannelToLinear(r) + 0.7152 * srgbChannelToLinear(g) + 0.0722 * srgbChannelToLinear(b);
}

/** WCAG contrast ratio between two relative luminances, in [1, 21]. */
function contrastRatio(luminanceA: number, luminanceB: number): number {
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Picks whichever of pure black/white text has the higher contrast ratio
 *  against `backgroundHex` - meets WCAG AA (4.5:1) for any background where
 *  that is mathematically achievable by black/white text alone. */
export function getAccessibleTextColor(backgroundHex: string): "#000000" | "#ffffff" {
  const bgLuminance = relativeLuminance(backgroundHex);
  const whiteContrast = contrastRatio(1, bgLuminance);
  const blackContrast = contrastRatio(0, bgLuminance);
  return whiteContrast >= blackContrast ? "#ffffff" : "#000000";
}

/** The actual contrast ratio `getAccessibleTextColor`'s pick achieves against
 *  `backgroundHex` - for tests/diagnostics that need to assert >= 4.5:1. */
export function bestTextContrastRatio(backgroundHex: string): number {
  const bgLuminance = relativeLuminance(backgroundHex);
  return Math.max(contrastRatio(1, bgLuminance), contrastRatio(0, bgLuminance));
}
