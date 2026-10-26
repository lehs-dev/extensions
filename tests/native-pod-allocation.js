// Run as a GNOME Shell automation script in an isolated headless session.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

function assert(value, message) {
    if (!value) throw new Error(message);
}

async function waitFor(predicate, message) {
    const until = GLib.get_monotonic_time() + 2000000;
    while (!predicate()) {
        assert(GLib.get_monotonic_time() < until, message);
        await Scripting.sleep(10);
    }
}

function checkContent(pod, allocated) {
    for (const actor of [pod._contentBox, pod._detailsBox]) {
        assert([actor.x, actor.y, actor.width, actor.height].every(Number.isFinite),
            `${pod.name}: finite content coordinates`);
    }
    if (!allocated) return;
    assert(pod._contentBox.has_allocation(), `${pod.name}: content allocated`);
    for (const item of pod._items.values()) {
        if (!item.visible) continue;
        assert(item.has_allocation(), `${pod.name}: visible item allocated`);
        assert(item.width > 0 && item.height > 0, `${pod.name}: visible item has area`);
        assert(item.get_transformed_position().every(Number.isFinite),
            `${pod.name}: visible item has valid stage coordinates`);
    }
}

export async function run() {
    console.log('START: native Shell pod allocation');
    assert(GLib.getenv('GSETTINGS_BACKEND') === 'memory', 'Use an isolated memory settings backend');
    const root = GLib.getenv('UNIFIED_DOCK_TEST_ROOT');
    assert(root, 'UNIFIED_DOCK_TEST_ROOT must point to the repository');
    const {QuickSettingsPod, InputMethodPod, ClockPod} =
        await import(`file://${root}/dash2dock-lite@custom/systemDock/modularPods.js`);
    const {computeUnifiedDockGeometry} =
        await import(`file://${root}/dash2dock-lite@custom/systemDock/systemDockLayout.js`);
    const {unifiedAppearance} = await import(`file://${root}/dash2dock-lite@custom/unifiedDock.js`);
    Main.overview.hide();
    await Scripting.sleep(300);
    const listeners = new Set();
    const systemState = {
        network: {available: true, iconName: 'network-wireless-symbolic'},
        bluetooth: {available: true, iconName: 'bluetooth-active-symbolic'},
        audio: {available: true, iconName: 'audio-volume-high-symbolic'},
        battery: {present: true, iconName: 'battery-full-symbolic'},
        inputSource: {available: true, shortName: 'en', displayName: 'English', iconName: 'input-keyboard-symbolic'},
        time: {hours: '23', hours24: '23', minutes: '56', dayOfWeek: 'Mon', dayOfMonth: '26', month: 'Oct'},
        addListener(callback) { listeners.add(callback); },
        removeListener(callback) { listeners.delete(callback); },
    };
    const extension = {global_scale: 1, modular_elevation_distance: 8};
    const pods = [];
    for (const Pod of [QuickSettingsPod, InputMethodPod, ClockPod]) {
        pods.push(new Pod({extension, systemState}));
    }
    const panelVisible = Main.layoutManager.panelBox.visible;
    Main.layoutManager.panelBox.hide();
    const application = Gio.Subprocess.new(['gjs', '-m', `${root}/tests/helpers/pod-hover-window.js`],
        Gio.SubprocessFlags.STDOUT_SILENCE);
    const pointer = global.stage.get_context().get_backend().get_default_seat()
        .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    try {
        const findWindow = () => global.get_window_actors().find(actor =>
            actor.meta_window?.get_title() === 'Unified Dock hover regression')?.meta_window;
        await waitFor(findWindow, 'Native Wayland test window mapped');
        const monitor = Main.layoutManager.primaryMonitor;
        findWindow().move_resize_frame(false, monitor.x, monitor.y, monitor.width, monitor.height);
        for (const pod of pods) pod.enable();
        for (const edge of ['left', 'right', 'top', 'bottom']) {
            for (const pod of pods) pod.setEdge(edge);
            const [quick, input, clock] = pods;
            const g = computeUnifiedDockGeometry({monitor: Main.layoutManager.primaryMonitor,
                ...unifiedAppearance(extension), edge,
                showQuickSettings: true, showInputMethod: true, showClock: true, showAppDock: true,
                quickSettingsContentHeight: quick.getMeasuredContentHeight(),
                quickSettingsContentWidth: quick.getMeasuredContentWidth(),
                inputMethodContentHeight: input.getMeasuredContentHeight(),
                inputMethodContentWidth: input.getMeasuredContentWidth(),
                clockContentHeight: clock.getMeasuredContentHeight(),
                clockContentWidth: clock.getMeasuredContentWidth(),
                appDockContentHeight: 300});
            assert(g.fits, `${edge}: geometry fits`);
            for (const [pod, geometry] of [[quick, g.quickSettings], [input, g.inputMethod], [clock, g.clock]]) {
                pod.place(geometry);
                checkContent(pod, false);
            }
            await Scripting.sleep(150);
            for (const pod of pods) {
                checkContent(pod, true);
                pod._elevation.setActive(true, true);
                checkContent(pod, true);
                pod._elevation.setActive(false, true);
                const box = pod._surface.boxes.reduce((largest, b) =>
                    !largest || (b.x2 - b.x1) * (b.y2 - b.y1) >
                    (largest.x2 - largest.x1) * (largest.y2 - largest.y1) ? b : largest, null);
                const [x, y] = pod.get_transformed_position();
                pointer.notify_absolute_motion(GLib.get_monotonic_time(),
                    x + (box.x1 + box.x2) / 2, y + (box.y1 + box.y2) / 2);
                await waitFor(() => pod._elevation.progress === 1, `${edge}: real pointer expands ${pod.name}`);
                pointer.notify_absolute_motion(GLib.get_monotonic_time(),
                    monitor.x + monitor.width / 2, monitor.y + monitor.height / 2);
                await waitFor(() => pod._elevation.progress === 0, `${edge}: crossing to an application collapses ${pod.name}`);
                // Reproduce a stale final hover after all crossing events have
                // already been delivered. No new input arrives to unstick it.
                pod._pointerInside = true;
                pod._syncElevation(true);
                assert(pod._elevation.progress === 1, 'stale hover reproduced');
                await waitFor(() => pod._elevation.progress === 0, `${edge}: global pointer check clears stale hover for ${pod.name}`);
                assert(!pod._pointerCheckId && !pod._pointerSignal, 'resting pod releases both pointer watches');
            }
            console.log(`PASS: native Shell pod allocation and application pointer crossing ${edge}`);
        }
    } finally {
        for (const pod of pods) pod.destroy();
        application.force_exit();
        pointer.run_dispose();
        Main.layoutManager.panelBox.visible = panelVisible;
    }
    assert(listeners.size === 0, 'All provider listeners released');
    console.log('PASS: native Shell pod allocation and cleanup');
}

export const METRICS = {};
