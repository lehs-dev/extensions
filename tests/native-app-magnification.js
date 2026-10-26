// Uses the complete extension and GNOME's native Dash in an isolated Shell.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

let paintSentinel;
function paintedFrame(fullRepaint = false) {
    return new Promise(resolve => {
        const id = global.stage.connect('after-paint', (_stage, view) => {
            global.stage.disconnect(id);
            resolve(view);
        });
        // Damage one pixel outside the dock to ensure a paint even when icons
        // have settled. A full-stage redraw masks incremental repaint bugs.
        if (fullRepaint) global.stage.queue_redraw();
        else paintSentinel.opacity = paintSentinel.opacity ? 0 : 255;
    });
}

async function compareRepaints(extension, dock) {
    const {default: Capture} = await import('gi://DockCapture?version=1.0');
    // Freeze automatic animation while comparing the same scene twice. The
    // foreground test still moves/scales the real renderer between samples.
    for (const timer of [extension._hiTimer, extension._loTimer, extension._timer]) timer.shutdown();
    const x = Math.max(0, Math.floor(dock.x)), y = Math.max(0, Math.floor(dock.y));
    const width = Math.min(Math.ceil(dock.width) + 2, global.stage.width - x);
    const height = Math.min(Math.ceil(dock.height) + 2, global.stage.height - y);
    for (let frame = 0; frame < 42; frame++) {
        dock._ensureLayout();
        const selected = dock._icons[Math.floor(frame / 7) % dock._icons.length];
        const source = selected.get_transformed_position();
        extension.simulated_pointer = [source[0] + selected.width / 2, source[1] + selected.height / 2];
        dock._preview = 0;
        dock.animator.animate(16);
        const view = await paintedFrame();
        const ordinary = Capture.read(view, x, y, width, height).get_data();
        // Only the reference requests a full repaint, after ordinary pixels
        // have been saved. No screenshot API touches the normal paint path.
        await paintedFrame(true);
        const reference = Capture.read(view, x, y, width, height).get_data();
        let differing = 0;
        for (let i = 0; i < ordinary.length; i++)
            if (i % 4 !== 3 && Math.abs(ordinary[i] - reference[i]) > 2) differing++;
        assert(differing === 0, `Incremental frame ${frame} differs from full repaint in ${differing} channels`);
    }
    console.log('PASS: incremental framebuffer pixels match full repaints (42 moving/scaling frames)');
}

export async function run() {
    assert(GLib.getenv('GSETTINGS_BACKEND') === 'memory', 'Use isolated memory settings');
    const path = `${GLib.getenv('UNIFIED_DOCK_TEST_ROOT')}/dash2dock-lite@custom`;
    const {default: Extension} = await import(`file://${path}/extension.js`);
    const dir = Gio.File.new_for_path(path);
    const metadata = JSON.parse(new TextDecoder().decode(dir.get_child('metadata.json').load_contents(null)[1]));
    Object.assign(metadata, {path, dir});
    const extension = new Extension(metadata);
    const previous = Main.extensionManager._extensions.get(metadata.uuid);
    Main.extensionManager._extensions.set(metadata.uuid, {metadata, stateObj: extension, uuid: metadata.uuid, path, dir});
    const settings = extension.getSettings('org.gnome.shell.extensions.dash2dock-lite');
    settings.set_boolean('autohide-dash', false);
    settings.set_boolean('animate-icons-unmute', true);
    settings.set_boolean('enable-screen-frame', false);
    settings.set_double('animation-magnify', 1);
    settings.set_double('animation-spread', 0.75);
    global.settings.set_strv('favorite-apps', ['firefox.desktop', 'org.gnome.Nautilus.desktop',
        'com.microsoft.VSCode.desktop', 'org.gnome.Ptyxis.desktop', 'org.gnome.TextEditor.desktop']);
    const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
    const stylesheet = dir.get_child('stylesheet.css');
    theme.load_stylesheet(stylesheet);
    Main.overview.hide();
    const backdrop = new St.Widget({width: global.stage.width, height: global.stage.height,
        style: 'background-color: white;'});
    global.window_group.add_child(backdrop);
    paintSentinel = new St.Widget({x: global.stage.width - 1, y: global.stage.height - 1,
        width: 1, height: 1, style: 'background-color: white;'});
    Main.uiGroup.add_child(paintSentinel);
    try {
        extension.enable();
        await Scripting.sleep(1000);
        const dock = extension.docks[0];
        assert(dock?._icons?.length >= 2, 'Native Dash supplies application sources');
        for (const actor of [dock, dock.renderArea, dock.struts, dock.dwell])
            assert(actor.get_offscreen_redirect() === Clutter.OffscreenRedirect.AUTOMATIC_FOR_OPACITY,
                'Ordinary dock paints avoid permanent flattened buffers');
        for (const scale of [0.75, 1, 1.5, 2]) for (const [edgeIndex, edge] of ['top', 'bottom', 'left', 'right'].entries()) {
            settings.set_double('global-scale', scale);
            settings.set_int('unified-edge', edgeIndex);
            await Scripting.sleep(70);
            assert(dock.renderArea.width === dock.width && dock.renderArea.height === dock.height,
                'Paint viewport has stable layout bounds instead of unscaled texture bounds');
            for (const rise of [0, 1]) {
                settings.set_double('animation-rise', rise);
                const selected = dock._icons[Math.floor(dock._icons.length / 2)];
                const source = selected.get_transformed_position();
                extension.simulated_pointer = [source[0] + selected.width / 2, source[1] + selected.height / 2];
                dock._preview = 0;
                for (let frame = 0; frame < 28; frame++) {
                    dock.animate(16);
                    await paintedFrame();
                    for (const icon of dock._icons) {
                        const [x, y] = icon._renderer.get_transformed_position();
                        const [width, height] = icon._renderer.get_transformed_size();
                        assert([x, y, width, height].every(Number.isFinite), `${edge}: finite renderer bounds`);
                        const vertical = edge === 'left' || edge === 'right';
                        assert(vertical ? x >= dock.x - 0.1 && x + width <= dock.x + dock.width + 0.1
                            : y >= dock.y - 0.1 && y + height <= dock.y + dock.height + 0.1,
                        `${edge}, scale ${scale}, rise ${rise}, frame ${frame}: renderer fits ` +
                        JSON.stringify({actual: [x,y,width,height], expected: icon._renderBounds,
                            dock: [dock.x,dock.y,dock.width,dock.height], translation: [icon._animationTranslationX,icon._animationTranslationY]}));
                    }
                }
                const textures = selected._renderer.get_children();
                assert(textures.length > 0, 'St.Icon loaded its asynchronous texture');
                for (const texture of textures) {
                    const [minification, magnification] = texture.get_content_scaling_filters();
                    assert(minification === Clutter.ScalingFilter.TRILINEAR && magnification === Clutter.ScalingFilter.LINEAR,
                        'Texture replacements preserve smooth minification and magnification');
                }
                extension.simulated_pointer = [global.stage.width / 2, global.stage.height / 2];
                for (let frame = 0; frame < 20; frame++) {
                    dock.animate(16);
                    await paintedFrame();
                }
            }
            console.log(`PASS: native Application Dock ${edge}, scale ${scale}`);
        }
        const artifacts = GLib.getenv('UNIFIED_DOCK_TEST_ARTIFACTS');
        if (artifacts) {
            settings.set_double('global-scale', 1);
            settings.set_double('animation-magnify', 0.3);
            settings.set_int('unified-edge', 2);
            await Scripting.sleep(70);
            const selected = dock._icons[2];
            const source = selected.get_transformed_position();
            extension.simulated_pointer = [source[0] + selected.width / 2, source[1] + selected.height / 2];
            for (let frame = 0; frame < 40; frame++) { dock.animate(16); await paintedFrame(); }
            GLib.mkdir_with_parents(artifacts, 0o700);
            const stream = Gio.File.new_for_path(`${artifacts}/application-left.png`).replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            await new Shell.Screenshot().screenshot_area(0, Math.max(0, Math.floor(dock.y) - 2),
                Math.ceil(dock.width) + 20, Math.ceil(dock.height) + 4, stream);
            stream.close(null);
        }
        if (GLib.getenv('UNIFIED_DOCK_TEST_PIXELS')) await compareRepaints(extension, dock);
    } finally {
        extension.disable();
        backdrop.destroy();
        paintSentinel.destroy();
        paintSentinel = null;
        theme.unload_stylesheet(stylesheet);
        if (previous) Main.extensionManager._extensions.set(metadata.uuid, previous);
        else Main.extensionManager._extensions.delete(metadata.uuid);
    }
    console.log('PASS: native Application Dock magnification and cleanup');
}

export const METRICS = {};
