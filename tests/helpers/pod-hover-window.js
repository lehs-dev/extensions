import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib';

Gtk.init();
const loop = new GLib.MainLoop(null, false);
const window = new Gtk.Window({title: 'Unified Dock hover regression', decorated: false,
    default_width: 1200, default_height: 800});
window.set_child(new Gtk.Label({label: 'Native Wayland surface for pod pointer crossing regression'}));
window.connect('close-request', () => { loop.quit(); return false; });
window.present();
loop.run();
