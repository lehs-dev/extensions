// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 Amir Hossein Karimi

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences, gettext as _ } from
    'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class WindowGapPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-desktop-display-symbolic',
        });
        window.add(page);

        const uniformGroup = new Adw.PreferencesGroup({
            title: _('Gap size'),
            description: _('Outer margins from each edge of the screen'),
        });
        page.add(uniformGroup);

        const uniformRow = new Adw.SwitchRow({
            title: _('Same gap on all edges'),
            subtitle: _('Use one size for top, bottom, left, and right'),
        });
        settings.bind(
            'uniform',
            uniformRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        uniformGroup.add(uniformRow);

        const gapSizeRow = new Adw.SpinRow({
            title: _('Gap size'),
            subtitle: _('Pixels of margin on every edge'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 200,
                step_increment: 1,
                page_increment: 10,
            }),
        });
        settings.bind(
            'gap-size',
            gapSizeRow,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );
        settings.bind(
            'uniform',
            gapSizeRow,
            'sensitive',
            Gio.SettingsBindFlags.DEFAULT
        );
        uniformGroup.add(gapSizeRow);

        const perEdgeGroup = new Adw.PreferencesGroup({
            title: _('Per-edge margins'),
            description: _('Used when "Same gap on all edges" is off'),
        });
        settings.bind(
            'uniform',
            perEdgeGroup,
            'sensitive',
            Gio.SettingsBindFlags.INVERT_BOOLEAN
        );
        page.add(perEdgeGroup);

        const edges = [
            ['margin-top', _('Top')],
            ['margin-bottom', _('Bottom')],
            ['margin-left', _('Left')],
            ['margin-right', _('Right')],
        ];

        for (const [key, title] of edges) {
            const row = new Adw.SpinRow({
                title,
                adjustment: new Gtk.Adjustment({
                    lower: 0,
                    upper: 200,
                    step_increment: 1,
                    page_increment: 10,
                }),
            });
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            perEdgeGroup.add(row);
        }
    }
}
