"""Check real Clutter allocations without touching the user's desktop/settings."""
import os
import argparse
from pathlib import Path
import shutil
import signal
import shlex
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--application', action='store_true', help='Check the complete Application Dock and its textures')
parser.add_argument('--artifacts', help='Save the isolated Application Dock screenshot to this directory')
parser.add_argument('--pixels', action='store_true', help='Compare incremental framebuffer pixels against a full repaint (requires Mutter development headers and a C compiler)')
arguments = parser.parse_args()
if arguments.pixels and not arguments.application:
    parser.error('--pixels requires --application')
script = 'native-app-magnification.js' if arguments.application else 'native-pod-allocation.js'
success = ('PASS: native Application Dock magnification and cleanup' if arguments.application
           else 'PASS: native Shell pod allocation and cleanup')
root = Path(__file__).resolve().parent.parent
directory = Path(tempfile.mkdtemp(prefix="unified-pod-allocation-"))
environment = os.environ.copy()
for name in ("DISPLAY", "WAYLAND_DISPLAY"):
    environment.pop(name, None)
for name, suffix in (("XDG_RUNTIME_DIR", "runtime"), ("XDG_CONFIG_HOME", "config"),
                     ("XDG_CACHE_HOME", "cache"), ("XDG_DATA_HOME", "data")):
    path = directory / suffix
    path.mkdir(mode=0o700)
    environment[name] = str(path)
environment.update(GSETTINGS_BACKEND="memory", GIO_USE_VFS="local",
                   UNIFIED_DOCK_TEST_ROOT=str(root), LIBGL_ALWAYS_SOFTWARE="1")
if arguments.artifacts:
    environment['UNIFIED_DOCK_TEST_ARTIFACTS'] = str(Path(arguments.artifacts).resolve())
def prepare_pixel_readback():
    library = directory / 'libdock-capture.so'
    flags = shlex.split(subprocess.check_output(['pkg-config', '--cflags', '--libs',
        'mutter-clutter-51', 'mutter-cogl-51'], text=True))
    subprocess.run(['cc', '-shared', '-fPIC', str(root / 'tests/helpers/capture-framebuffer.c'),
        '-o', str(library), *flags], check=True)
    subprocess.run(['gi-compile-repository', '--includedir=/usr/share/gir-1.0',
        f'--shared-library={library}', f'--output={directory / "DockCapture-1.0.typelib"}',
        str(root / 'tests/helpers/DockCapture-1.0.gir')], check=True)
    environment['GI_TYPELIB_PATH'] = f'{directory}:{environment.get("GI_TYPELIB_PATH", "")}'
    environment['UNIFIED_DOCK_TEST_PIXELS'] = '1'
command = ["dbus-run-session", "--", "gnome-shell", "--headless", "--wayland",
           "--no-x11", "--virtual-monitor=1920x1080",
           f"--automation-script={root / 'tests' / script}"]
try:
    if arguments.pixels:
        prepare_pixel_readback()
    with (directory / "shell.log").open("w+") as log:
        process = subprocess.Popen(command, env=environment, stdout=log,
                                   stderr=subprocess.STDOUT, start_new_session=True)
        try:
            code = process.wait(timeout=55 if arguments.application else 25)
        except subprocess.TimeoutExpired:
            code = 124
        finally:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
        log.seek(0)
        output = log.read()
        if code == 0 and success in output:
            print("\n".join(line for line in output.splitlines() if "PASS:" in line))
        else:
            print(output)
            code = code or 1
finally:
    shutil.rmtree(directory, ignore_errors=True)
raise SystemExit(code)
