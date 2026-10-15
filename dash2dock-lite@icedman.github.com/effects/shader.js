'use strict';

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';

export function registerShaderEffect(effectClass) {
  if (typeof Clutter.ShaderEffect.new_with_snippet === 'function') {
    // GNOME 51 caches one snippet per effect subclass. Its source is loaded by
    // preload() before attaching the effect and before the first paint.
    Object.defineProperty(effectClass.prototype, 'vfunc_get_static_snippet', {
      value() {
        const source = this._source || '';
        const main = /\bvoid\s+main\s*\(\s*(?:void)?\s*\)\s*\{/.exec(source);
        const snippet = Cogl.Snippet.new(
          Cogl.SnippetHook.FRAGMENT,
          main ? source.slice(0, main.index) : '',
          null
        );
        snippet.set_replace(main
          ? source.slice(main.index + main[0].length, source.lastIndexOf('}'))
          : 'cogl_color_out = cogl_color_in;');
        return snippet;
      },
    });
  }
  return GObject.registerClass({}, effectClass);
}
