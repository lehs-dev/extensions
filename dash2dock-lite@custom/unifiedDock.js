'use strict';

// All dimensions are logical pixels. Monitor geometry_scale is used by St/Cairo
// for rendering, never as a second layout multiplier.
export function unifiedAppearance(extension = {}) {
  const scale = Number.isFinite(extension.global_scale)
    ? Math.max(0.5, Math.min(2, extension.global_scale)) : 1;
  const px = value => value * scale;
  return {
    scale, width: Math.round(px(34)), appIconSize: Math.round(px(30)), iconSize: Math.round(px(16)),
    fontSize: px(11), detailFontSize: px(12), padding: px(3),
    itemSpacing: px(3), horizontalPadding: px(2),
    spacing: px(Math.max(0, extension.modular_min_spacing ?? 16)),
    flareWidth: px(extension.flare_width ?? 14),
    footDepth: px(extension.foot_depth ?? 4),
    cornerRadius: px(extension.attached_corner_radius ?? 10),
    borderThickness: px(extension.border_thickness ?? 0),
  };
}

export const UNIFIED_EDGES = ['top', 'bottom', 'left', 'right'];
export const unifiedEdge = extension => UNIFIED_EDGES[extension?.unified_edge ?? 2] ?? 'left';

export function unifiedAppMetrics(extension = {}) {
  const a = unifiedAppearance(extension);
  const iconSize = Math.round(a.appIconSize);
  const slotSize = Math.round(iconSize + a.scale * (2 + 5 * Math.max(0, extension.animation_spread ?? 0.5)) + a.itemSpacing);
  return {...a, iconSize, slotSize};
}

// Additive, idempotent migration. Keep every legacy key (including layout mode)
// intact for downgrade and never replace an explicit Unified Dock preference.
export function migrateUnifiedSettings(settings) {
  const version = settings.get_int('unified-config-version');
  if (version >= 2) return;
  const saved = key => settings.get_user_value(key) !== null;
  if (!saved('unified-edge')) {
    const edge = version === 1 || saved('unified-position')
      ? settings.get_int('unified-position') >= 2 ? 3 : 2
      : settings.get_int('desktop-layout') === 1 ? 2
        : [1, 2, 3, 0][settings.get_int('dock-location')] ?? 2;
    settings.set_int('unified-edge', edge);
  }
  if (!saved('background-opacity') && saved('background-color'))
    settings.set_double('background-opacity', settings.get_value('background-color').deepUnpack()[3]);
  if (settings.get_int('desktop-layout') === 0) {
    for (const name of ['network', 'bluetooth', 'volume', 'battery']) {
      const target = `modular-show-${name}`;
      const source = `system-dock-show-${name}`;
      if (!saved(target) && saved(source)) settings.set_boolean(target, settings.get_boolean(source));
    }
  }
  // Write the marker last so an interrupted migration can be retried safely.
  settings.set_int('unified-config-version', 2);
}
