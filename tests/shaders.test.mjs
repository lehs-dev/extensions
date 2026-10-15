import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadModule} from './helpers/shell.mjs';

for (const [filename, exportName] of [['tint', 'TintEffect'], ['monochrome', 'MonochromeEffect'],
    ['color', 'ColorEffect'], ['blur', 'BlurEffect']]) {
    for (const modern of [true, false]) {
        test(`${filename} shader supports ${modern ? 'GNOME 51 snippets' : 'legacy ShaderEffect'}`, async () => {
            class ShaderEffect {
                _init() {}
                set_uniform_value() {}
                set_enabled(enabled) { this.enabled = enabled; }
            }
            if (modern)
                ShaderEffect.new_with_snippet = () => {};
            else
                ShaderEffect.prototype.set_shader_source = function (source) { this.source = source; };
            class Snippet {
                static new(hook, declarations) { return new Snippet(declarations); }
                constructor(declarations) { this.declarations = declarations; }
                set_replace(body) { this.body = body; }
            }
            const directory = 'dash2dock-lite@icedman.github.com';
            const namespace = await loadModule(`${directory}/effects/${filename}_effect.js`, {
                mocks: {
                    'gi://Clutter': {default: {ShaderEffect}},
                    'gi://Cogl': {default: {Snippet, SnippetHook: {FRAGMENT: 1}}},
                    'gi://GObject': {default: {registerClass: (meta, cls) => {
                        if (!modern)
                            assert.equal(Object.hasOwn(cls.prototype, 'vfunc_get_static_snippet'), false);
                        return cls;
                    }}},
                    'gi://GLib': {default: {build_filenamev: parts => join(...parts)}},
                    'gi://Shell': {default: {get_file_contents_utf8_sync: path => readFileSync(path, 'utf8')}},
                },
            });
            const effect = new namespace[exportName]();
            effect._init({color: [0.4, 0.5, 0.6, 0.7]});
            effect.preload(directory);
            assert.equal(effect.enabled, true);
            if (modern) {
                const snippet = effect.vfunc_get_static_snippet();
                assert.match(snippet.declarations, /uniform sampler2D tex/);
                assert.match(snippet.body, /cogl_color_out\s*=/);
                assert.doesNotMatch(snippet.body, /void main/);
                assert.equal(typeof effect.set_shader_source, 'undefined');
            } else {
                assert.match(effect.source, /void main/);
            }
        });
    }
}
