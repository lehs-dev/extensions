import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';

const EFFECT_NAME = 'tiling-assistant-rounded-corners';
const RADIUS = 12;

const DECLARATIONS = `
uniform sampler2D tex;
uniform float buffer_width;
uniform float buffer_height;
uniform float frame_left;
uniform float frame_top;
uniform float frame_right;
uniform float frame_bottom;
uniform float corner_radius;
uniform float pixel_size;
`;
const FRAGMENT = `
vec2 position = cogl_tex_coord_in[0].xy * vec2(buffer_width, buffer_height);
vec4 frame_bounds = vec4(frame_left, frame_top, frame_right, frame_bottom);
vec2 half_size = (frame_bounds.zw - frame_bounds.xy) * 0.5;
vec2 center = (frame_bounds.xy + frame_bounds.zw) * 0.5;
vec2 delta = abs(position - center) - half_size + vec2(corner_radius);
float distance = length(max(delta, vec2(0.0)))
    + min(max(delta.x, delta.y), 0.0) - corner_radius;
float coverage = 1.0 - smoothstep(-pixel_size * 0.5, pixel_size * 0.5, distance);
cogl_color_out = texture2D(tex, cogl_tex_coord_in[0].xy) * cogl_color_in * coverage;
`;

class RoundedCornersEffect extends Clutter.ShaderEffect {
    _init() {
        super._init();
        this._uniforms = new Map();
        // GNOME 50 uses shader source; GNOME 51 uses the static snippet below.
        if (this.set_shader_source)
            this.set_shader_source(`${DECLARATIONS}\nvoid main() {\n${FRAGMENT}\n}`);
    }

    _setFloat(name, value) {
        if (this._uniforms.get(name) === value)
            return;
        if (this.set_uniform_float) {
            this.set_uniform_float(name, 1, [value]);
        } else {
            // GJS otherwise sends whole numbers as integers, which GLSL rejects
            // for float uniforms on the legacy ShaderEffect API.
            const uniform = new GObject.Value();
            uniform.init(GObject.TYPE_FLOAT);
            uniform.set_float(value);
            this.set_uniform_value(name, uniform);
        }
        this._uniforms.set(name, value);
    }

    vfunc_paint_target(paintNode, paintContext) {
        const window = this.window;
        if (window) {
            const frame = window.get_frame_rect();
            const buffer = window.get_buffer_rect();
            if (buffer.width > 0 && buffer.height > 0 && frame.width > 0 && frame.height > 0) {
                const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
                const radius = Math.min(RADIUS * scale, frame.width / 2, frame.height / 2);
                const texture = this.get_texture();
                this.set_uniform_value('tex', 0);
                this._setFloat('buffer_width', buffer.width);
                this._setFloat('buffer_height', buffer.height);
                // Frame coordinates exclude client shadows and invisible X11 borders.
                this._setFloat('frame_left', frame.x - buffer.x);
                this._setFloat('frame_top', frame.y - buffer.y);
                this._setFloat('frame_right', frame.x + frame.width - buffer.x);
                this._setFloat('frame_bottom', frame.y + frame.height - buffer.y);
                this._setFloat('corner_radius', radius);
                this._setFloat('pixel_size', texture ? buffer.width / texture.get_width() : 1);
            }
        }
        super.vfunc_paint_target(paintNode, paintContext);
    }
}

// Register only vfuncs available on the running Clutter version.
if (typeof Clutter.ShaderEffect.new_with_snippet === 'function') {
    // Assignment would resolve Clutter's unimplemented native vfunc first.
    Object.defineProperty(RoundedCornersEffect.prototype, 'vfunc_get_static_snippet', {
        value() {
            const snippet = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, DECLARATIONS, null);
            snippet.set_replace(FRAGMENT);
            return snippet;
        },
    });
}
const Effect = GObject.registerClass({GTypeName: 'TilingAssistantRoundedCornersEffect'}, RoundedCornersEffect);

/** Keep native maximize/fullscreen behavior while rounding their square surfaces. */
export default class RoundedCornersManager {
    constructor() {
        this._windows = new Map();
        this._createdId = global.display.connect('window-created', (_, window) => this._track(window));
        // A newly created window may not have a compositor actor until it maps.
        this._mapId = global.window_manager.connect('map', (_, actor) => this._track(actor.meta_window));
        global.display.list_all_windows().forEach(window => this._track(window));
    }

    _track(window) {
        if (!window)
            return;

        const type = window.get_window_type();
        if (![Meta.WindowType.NORMAL, Meta.WindowType.DIALOG, Meta.WindowType.MODAL_DIALOG].includes(type))
            return;

        if (!this._windows.has(window)) {
            const entry = {actor: null, effect: null, destroyId: null, signals: []};
            this._windows.set(window, entry);
            for (const signal of ['notify::maximized-horizontally', 'notify::maximized-vertically',
                'notify::fullscreen', 'size-changed', 'position-changed']) {
                entry.signals.push(window.connect(signal, () => this._sync(window)));
            }
            entry.signals.push(window.connect('unmanaging', () => this._untrack(window)));
        }
        this._sync(window);
    }

    _sync(window) {
        const entry = this._windows.get(window);
        const actor = window.get_compositor_private();
        if (entry.actor !== actor) {
            this._detachActor(entry);
            entry.actor = actor;
            if (actor) {
                entry.destroyId = actor.connect('destroy', () => {
                    // The actor owns and disposes its effects during destruction.
                    if (entry.effect)
                        entry.effect.window = null;
                    entry.actor = entry.effect = entry.destroyId = null;
                });
            }
        }
        if (!actor)
            return;

        const rounded = window.is_fullscreen() || window.maximizedHorizontally || window.maximizedVertically;
        if (rounded && !entry.effect) {
            entry.effect = new Effect();
            entry.effect.window = window;
            actor.add_effect_with_name(EFFECT_NAME, entry.effect);
        } else if (!rounded) {
            this._removeEffect(entry);
        }
        entry.effect?.queue_repaint();
    }

    _removeEffect(entry) {
        if (!entry.effect)
            return;
        entry.effect.window = null;
        entry.actor.remove_effect(entry.effect);
        entry.effect = null;
    }

    _detachActor(entry) {
        this._removeEffect(entry);
        if (entry.destroyId)
            entry.actor.disconnect(entry.destroyId);
        entry.actor = entry.destroyId = null;
    }

    _untrack(window) {
        const entry = this._windows.get(window);
        if (!entry)
            return;
        this._detachActor(entry);
        entry.signals.forEach(id => window.disconnect(id));
        this._windows.delete(window);
    }

    destroy() {
        global.display.disconnect(this._createdId);
        global.window_manager.disconnect(this._mapId);
        for (const window of this._windows.keys())
            this._untrack(window);
    }
}
