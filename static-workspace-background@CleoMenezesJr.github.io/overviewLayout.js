/* Separate layouts for the window picker and the app grid card. */

const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

/**
 * Return rectangles in the area's coordinates without rounding fractional scales.
 * Spacing compresses on small allocations; zero-sized allocations stay empty.
 */
export function computeOverviewLayout(area, {scale = 1, dashHeight = 0} = {}) {
  const unit = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const x = finite(area.x, 0);
  const y = finite(area.y, 0);
  const width = Math.max(0, finite(area.width, 0));
  const height = Math.max(0, finite(area.height, 0));

  // Keep room for the external Dock, while retaining usable card space even
  // during a very small intermediate allocation or an oversized Dock report.
  const dockReserve = Math.min(
    Math.max(72 * unit, finite(dashHeight, 0)), height * 0.4);
  const availableHeight = height - dockReserve;
  const marginX = Math.min(24 * unit, width / 4);
  const marginY = Math.min(24 * unit, availableHeight / 4);
  const cardWidth = Math.min(1400 * unit, width - 2 * marginX);
  const cardHeight = Math.min(960 * unit, availableHeight - 2 * marginY);
  const card = {
    x: x + (width - cardWidth) / 2,
    y: y + (availableHeight - cardHeight) / 2,
    width: cardWidth,
    height: cardHeight,
  };

  const paddingX = Math.min(28 * unit, card.width / 8);
  const paddingY = Math.min(28 * unit, card.height / 8);
  const contentWidth = card.width - 2 * paddingX;
  const contentHeight = card.height - 2 * paddingY;
  const stripHeight = Math.min(160 * unit, availableHeight * 0.2) * 0.85;
  const stripPadding = Math.min(8 * unit, availableHeight * 0.1);
  const gap = Math.min(20 * unit, availableHeight * 0.05);
  const workspaceStrip = {
    x, y, width,
    height: stripHeight + 2 * stripPadding,
  };
  const workspaces = {
    x: x + marginX,
    y: y + stripPadding,
    width: width - 2 * marginX,
    height: stripHeight,
  };
  const picker = {
    x: workspaces.x,
    y: y + workspaceStrip.height + gap,
    width: workspaces.width,
    height: availableHeight - marginY - workspaceStrip.height - gap,
  };
  const apps = {
    x: card.x + paddingX,
    y: card.y + paddingY,
    width: contentWidth,
    height: contentHeight,
  };

  return {card, workspaceStrip, workspaces, picker, apps};
}
