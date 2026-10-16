// Theme defaults are applied only while the user has no explicit color saved.
const PALETTES = {
  dark: {
    'background-color': [0.08, 0.08, 0.09, 0.72],
    'border-color': [1, 1, 1, 0.25],
    'separator-color': [1, 1, 1, 0.25],
    'running-indicator-color': [1, 1, 1, 0.75],
  },
  light: {
    'background-color': [1, 1, 1, 0.55],
    'border-color': [1, 1, 1, 0.25],
    'separator-color': [0, 0, 0, 0.18],
    'running-indicator-color': [0.12, 0.12, 0.14, 0.7],
  },
};

export function dockColor(name, value, scheme, custom = false) {
  return custom ? value : PALETTES[scheme]?.[name] || value;
}
