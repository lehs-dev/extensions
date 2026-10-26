// Test-only readback: read an already painted view, without requesting a new
// stage paint as Shell.Screenshot and Clutter.Stage.read_pixels do.
#include <clutter/clutter.h>

GBytes *dock_capture_read (GObject *object, int x, int y, int width, int height)
{
  g_return_val_if_fail (CLUTTER_IS_STAGE_VIEW (object), NULL);
  g_return_val_if_fail (width > 0 && height > 0 && width <= 4096 && height <= 4096, NULL);
  CoglFramebuffer *framebuffer = clutter_stage_view_get_framebuffer (CLUTTER_STAGE_VIEW (object));
  gsize size = (gsize) width * height * 4;
  guint8 *pixels = g_malloc0 (size);
  if (!cogl_framebuffer_read_pixels (framebuffer, x, y, width, height,
                                     COGL_PIXEL_FORMAT_RGBA_8888, pixels))
    {
      g_free (pixels);
      return NULL;
    }
  return g_bytes_new_take (pixels, size);
}
