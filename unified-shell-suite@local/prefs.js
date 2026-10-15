/**
 * Unified Shell Suite - Preferences Window
 * Built with Libadwaita (Adw) for GNOME 51+.
 */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class UnifiedShellSuitePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // -------------------------------------------------------------
        // PAGE 1: Compositing & Effects
        // -------------------------------------------------------------
        const compPage = new Adw.PreferencesPage({
            title: 'Compositing',
            icon_name: 'applications-graphics-symbolic',
        });

        const blurGroup = new Adw.PreferencesGroup({ title: 'Background Blur' });
        const blurRow = new Adw.SwitchRow({ title: 'Enable Blur Effects' });
        settings.bind('blur-enabled', blurRow, 'active', 0);
        blurGroup.add(blurRow);

        const blurSigmaRow = new Adw.SpinRow({
            title: 'Blur Sigma (Intensity)',
            adjustment: new Gtk.Adjustment({ lower: 5, upper: 100, step_increment: 5, value: 30 }),
        });
        settings.bind('blur-sigma', blurSigmaRow, 'value', 0);
        blurGroup.add(blurSigmaRow);

        const blurPanelRow = new Adw.SwitchRow({ title: 'Blur Top Panel' });
        settings.bind('blur-panel', blurPanelRow, 'active', 0);
        blurGroup.add(blurPanelRow);

        const blurOverviewRow = new Adw.SwitchRow({ title: 'Blur Overview' });
        settings.bind('blur-overview', blurOverviewRow, 'active', 0);
        blurGroup.add(blurOverviewRow);
        compPage.add(blurGroup);

        const magicLampGroup = new Adw.PreferencesGroup({ title: 'Magic Lamp Effect' });
        const magicLampRow = new Adw.SwitchRow({
            title: 'Enable Magic Lamp Animation',
            subtitle: 'Smooth genie lamp minimize effect with zero deadlock risk',
        });
        settings.bind('magic-lamp-enabled', magicLampRow, 'active', 0);
        magicLampGroup.add(magicLampRow);

        const magicLampDurationRow = new Adw.SpinRow({
            title: 'Animation Duration (ms)',
            adjustment: new Gtk.Adjustment({ lower: 100, upper: 1000, step_increment: 50, value: 300 }),
        });
        settings.bind('magic-lamp-duration', magicLampDurationRow, 'value', 0);
        magicLampGroup.add(magicLampDurationRow);
        compPage.add(magicLampGroup);

        const staticBgGroup = new Adw.PreferencesGroup({ title: 'Workspace Background' });
        const staticBgRow = new Adw.SwitchRow({
            title: 'Static Wallpaper Switch',
            subtitle: 'Keeps wallpaper stationary without breaking 1:1 touchpad gestures',
        });
        settings.bind('static-background-enabled', staticBgRow, 'active', 0);
        staticBgGroup.add(staticBgRow);
        compPage.add(staticBgGroup);

        window.add(compPage);

        // -------------------------------------------------------------
        // PAGE 2: Window Management & Tiling
        // -------------------------------------------------------------
        const tilingPage = new Adw.PreferencesPage({
            title: 'Window & Tiling',
            icon_name: 'view-paged-symbolic',
        });

        const tilingGroup = new Adw.PreferencesGroup({ title: 'Adaptive Tiling' });
        const tilingRow = new Adw.SwitchRow({ title: 'Enable Edge Snap & Tiling' });
        settings.bind('tiling-enabled', tilingRow, 'active', 0);
        tilingGroup.add(tilingRow);

        const previewRow = new Adw.SwitchRow({ title: 'Show Tiling Preview' });
        settings.bind('tiling-preview', previewRow, 'active', 0);
        tilingGroup.add(previewRow);
        tilingPage.add(tilingGroup);

        const gapGroup = new Adw.PreferencesGroup({ title: 'Window Spacing & Gaps' });
        const winGapRow = new Adw.SpinRow({
            title: 'Inner Window Gap (px)',
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 64, step_increment: 2, value: 8 }),
        });
        settings.bind('window-gap-size', winGapRow, 'value', 0);
        gapGroup.add(winGapRow);

        const screenGapRow = new Adw.SpinRow({
            title: 'Outer Screen Margin (px)',
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 64, step_increment: 2, value: 8 }),
        });
        settings.bind('screen-gap-size', screenGapRow, 'value', 0);
        gapGroup.add(screenGapRow);
        tilingPage.add(gapGroup);

        window.add(tilingPage);

        // -------------------------------------------------------------
        // PAGE 3: Dock & Desktop Tweaks
        // -------------------------------------------------------------
        const dockPage = new Adw.PreferencesPage({
            title: 'Dock & Tweaks',
            icon_name: 'user-desktop-symbolic',
        });

        const dockGroup = new Adw.PreferencesGroup({ title: 'Application Dock' });
        const dockRow = new Adw.SwitchRow({ title: 'Enable Floating Dock' });
        settings.bind('dock-enabled', dockRow, 'active', 0);
        dockGroup.add(dockRow);

        const dockAutohideRow = new Adw.SwitchRow({ title: 'Autohide on Focus' });
        settings.bind('dock-autohide', dockAutohideRow, 'active', 0);
        dockGroup.add(dockAutohideRow);

        const dockSizeRow = new Adw.SpinRow({
            title: 'Dock Icon Size (px)',
            adjustment: new Gtk.Adjustment({ lower: 24, upper: 96, step_increment: 4, value: 48 }),
        });
        settings.bind('dock-icon-size', dockSizeRow, 'value', 0);
        dockGroup.add(dockSizeRow);
        dockPage.add(dockGroup);

        const tweaksGroup = new Adw.PreferencesGroup({ title: 'Desktop Tweaks' });
        const panelVisRow = new Adw.SwitchRow({ title: 'Show Top Panel' });
        settings.bind('tweak-panel-visible', panelVisRow, 'active', 0);
        tweaksGroup.add(panelVisRow);

        const activitiesRow = new Adw.SwitchRow({ title: 'Show Activities Button' });
        settings.bind('tweak-show-activities', activitiesRow, 'active', 0);
        tweaksGroup.add(activitiesRow);
        dockPage.add(tweaksGroup);

        window.add(dockPage);

        // -------------------------------------------------------------
        // PAGE 4: Overlays & Utilities
        // -------------------------------------------------------------
        const overlaysPage = new Adw.PreferencesPage({
            title: 'Utilities',
            icon_name: 'preferences-system-windows-symbolic',
        });

        const spotGroup = new Adw.PreferencesGroup({ title: 'Spotlight Search' });
        const spotRow = new Adw.SwitchRow({
            title: 'Enable Spotlight Popup',
            subtitle: 'Triggered by Super+Space without modifying Overview DOM',
        });
        settings.bind('spotlight-enabled', spotRow, 'active', 0);
        spotGroup.add(spotRow);
        overlaysPage.add(spotGroup);

        const clipGroup = new Adw.PreferencesGroup({ title: 'Clipboard History' });
        const clipRow = new Adw.SwitchRow({ title: 'Enable Clipboard History' });
        settings.bind('clipboard-enabled', clipRow, 'active', 0);
        clipGroup.add(clipRow);

        const clipMaxRow = new Adw.SpinRow({
            title: 'Max Stored Items',
            adjustment: new Gtk.Adjustment({ lower: 10, upper: 200, step_increment: 10, value: 50 }),
        });
        settings.bind('clipboard-max-items', clipMaxRow, 'value', 0);
        clipGroup.add(clipMaxRow);
        overlaysPage.add(clipGroup);

        const kimGroup = new Adw.PreferencesGroup({ title: 'Input Method Helper' });
        const kimRow = new Adw.SwitchRow({
            title: 'Enable Kimpanel Helper',
            subtitle: 'Accurate candidate window positioning for Fcitx / IBus',
        });
        settings.bind('kimpanel-enabled', kimRow, 'active', 0);
        kimGroup.add(kimRow);
        overlaysPage.add(kimGroup);

        window.add(overlaysPage);
    }
}

