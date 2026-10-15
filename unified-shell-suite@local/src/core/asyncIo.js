/**
 * Unified Shell Suite - AsyncIO
 * Pure asynchronous file I/O utilities eliminating Main UI Thread blockage.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * Loads the UTF-8 contents of a Gio.File asynchronously.
 * @param {Gio.File} file 
 * @returns {Promise<string>}
 */
export async function loadFileContentsAsync(file) {
    return new Promise((resolve, reject) => {
        file.load_contents_async(null, (src, res) => {
            try {
                const [success, contents] = src.load_contents_finish(res);
                if (!success) {
                    reject(new Error(`Failed to load contents from ${file.get_path()}`));
                    return;
                }
                const decoder = new TextDecoder('utf-8');
                resolve(decoder.decode(contents));
            } catch (e) {
                reject(e);
            }
        });
    });
}

/**
 * Replaces the contents of a Gio.File asynchronously with string data.
 * @param {Gio.File} file 
 * @param {string} stringData 
 * @returns {Promise<boolean>}
 */
export async function replaceFileContentsAsync(file, stringData) {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(stringData);
    const glibBytes = new GLib.Bytes(bytes);

    return new Promise((resolve, reject) => {
        file.replace_contents_bytes_async(
            glibBytes,
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            null,
            (src, res) => {
                try {
                    const [success] = src.replace_contents_finish(res);
                    resolve(success);
                } catch (e) {
                    reject(e);
                }
            }
        );
    });
}

/**
 * Ensures parent directory exists asynchronously.
 * @param {Gio.File} dir 
 */
export async function ensureDirectoryExistsAsync(dir) {
    try {
        if (!dir.query_exists(null)) {
            dir.make_directory_with_parents(null);
        }
    } catch (e) {
        if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)) {
            throw e;
        }
    }
}

