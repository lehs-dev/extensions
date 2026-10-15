# Rà soát extension cho GNOME Shell 51

Ngày kiểm tra: 15/10/2026. Đã đọc metadata và rà soát đường chạy Shell, quản lý signal/callback, animation và các API bị bỏ của 11 extension trong thư mục.

## Cơ sở API

- [Hướng dẫn port GNOME Shell 51](https://gjs.guide/extensions/upgrading/gnome-shell-51.html): bỏ thuộc tính `vertical` của St widget, bỏ `Shell.GLSLEffect` và `Clutter.get_default_backend()`, thêm reduced motion; `disable()` phải đồng bộ. Các event signal cũ vẫn hoạt động nhưng đã deprecated.
- [Clutter.ShaderEffect 51](https://gnome.pages.gitlab.gnome.org/mutter/clutter/class.ShaderEffect.html): shader dùng `Cogl.Snippet` qua `vfunc_get_static_snippet()`; không còn `set_shader_source()`.
- [workspaceAnimation.js tại tag 51.0](https://github.com/GNOME/gnome-shell/blob/51.0/js/ui/workspaceAnimation.js): khi bắt đầu lại một gesture, Shell hủy transition trên `MonitorGroup`; animation riêng trên actor con không bị hủy theo.
- [overviewControls.js tại tag 51.0](https://github.com/GNOME/gnome-shell/blob/51.0/js/ui/overviewControls.js): `_searchEntryBin` là container của ô tìm kiếm trong Overview.
- [layout.js tại tag 51.0](https://github.com/GNOME/gnome-shell/blob/51.0/js/ui/layout.js): tham số chrome gồm `affectsStruts` và `trackFullscreen`; `affectsInputRegion` không còn hợp lệ.

Các kết luận về nguyên nhân bên dưới dựa trên mã cục bộ và test tái hiện. Chưa đo frame time hay xác nhận cảm giác animation trên thiết bị thật.

## Kết quả và thay đổi

| Extension | Phát hiện và xử lý |
| --- | --- |
| Just Perfection | Sửa truy cập parent `null` khi ô tìm kiếm bị tách khỏi Overview; dùng bin của Overview để không ẩn/resize popup đang chứa ô tìm kiếm. Callback show kiểm tra lại parent. Sửa cùng lỗi ở margin của panel, tham số chrome cho Shell 50+, và signal ID của `window-marked-urgent` bị ghi đè. |
| Dash2Dock Lite / Animated | Giữ scale của icon nguồn ẩn ở 1; chỉ scale renderer. Bỏ phần cộng scale đột ngột khi đổi icon gần nhất, ngưỡng nhảy scale 1.9→2, làm tròn spread và cache khóa vị trí cũ. Expansion được căn giữa liên tục. Kích thước dừng đúng target. Sửa nhánh tái sử dụng object animation trong timer. Port bốn shader sang snippet trên GNOME 51, giữ API cũ cho bản trước. Tôn trọng reduced motion khi phóng icon. |
| Static Workspace Background | Bỏ animation nảy hai pha trên actor con. Pha này sống sót qua thao tác hủy gesture của Shell và trì hoãn callback kết thúc. Giữ nền tĩnh, trả hoàn toàn thời gian/easing/cancellation của chuyển workspace cho Shell, cả bàn phím lẫn touchpad. Tắt extension không tự gọi callback hoàn tất của Shell nữa. |
| Blur my Shell | Tránh thêm lại background vào parent khi switch đã được chuẩn bị. Bỏ qua cửa sổ không còn compositor actor. Tắt component giữa switch sẽ gỡ background và hook. Hook còn bị extension khác giữ lại sẽ không thực hiện thao tác UI khi component đã tắt; khôi phục hook không ghi đè wrapper của bên khác. |
| Clipboard History | Chặn callback đọc lịch sử/clipboard sau destroy, chặn reply đến sau khi bật private mode; sửa enum dùng kiểm tra MIME. Phím previous/next chịu được lịch sử rỗng hoặc chưa tải xong. Hủy timeout focus khi menu đóng/mở lại; dọn notification source. Menu lấy chiều rộng màn hình chứa panel. Chuyển dữ liệu cũ dùng `TextDecoder` để giữ nội dung UTF-8 và favorites. |
| Tiling Assistant | Kiểm tra cancellation sau đọc session state và trước khi tiếp tục enable. Disable sớm không ghi `undefined` vào phương thức của panel. Khôi phục phương thức chỉ khi extension vẫn sở hữu override. |
| Kimpanel | So sánh lookup cursor với cursor cũ thay vì preedit caret; highlight ứng viên cập nhật đúng và không redraw khi cursor không đổi. |
| Spotlight | Chạy test module lấy/trả ô tìm kiếm thật cùng API visibility của Just Perfection. Không sửa mã extension này. |
| Window Gap | Test màn hình nhỏ, tọa độ monitor âm, tái sử dụng actor, thu hồi chrome. Không phát hiện lỗi cần sửa trong các ca này. |
| Light Style | Test nhiều chu kỳ enable/disable và phục hồi color scheme ban đầu. Không phát hiện lỗi cần sửa trong các ca này. |

## Chạy kiểm tra trong devcontainer

Dockerfile của devcontainer cài Node.js, GJS và công cụ GLib. Không cần cài dependency JavaScript từ npm.

```sh
node --experimental-vm-modules --test tests/*.test.mjs
node scripts/test-native.mjs
node scripts/check.mjs
git diff --check
```

- Bộ test Node chạy module extension thật với GI/Shell adapter có khai báo tường minh. Các ca gồm ô tìm kiếm bị reparent, hover ở bốn cạnh, reduced motion, 100 lần đảo chiều workspace, callback muộn, bật/tắt giữa thao tác và tương tác hook.
- Test native chạy GJS/Gio thật, kiểm tra migration UTF-8/favorites, đọc lại log đã lưu và phục hồi log có operation ID bị ghi dở. Cache và dữ liệu test nằm trong thư mục tạm riêng, được xóa sau khi chạy.
- Check đọc cú pháp JavaScript dưới dạng ESM, kiểm tra metadata khai báo Shell 51 và chạy `glib-compile-schemas --strict --dry-run` cho mọi thư mục schema.

Kết quả đã chạy: **48/48 test Node qua**, test native GJS/Gio qua, **180 file JavaScript và 9 thư mục schema không lỗi**, `git diff --check` qua. Cùng bộ test Node chạy trên snapshot ban đầu `c69bd6d` có **35 ca thất bại / 13 ca qua**; test native trên snapshot đó thất bại vì mất lịch sử UTF-8 trong migration.

## Kiểm tra tiếp trên phiên GNOME 51

Container hiện không chạy GNOME Shell/Mutter 51 hay phiên Wayland có GPU/touchpad. Test adapter không xác nhận được shader biên dịch trên GPU, vùng click thực tế, fractional scaling hoặc frame pacing. GJS trong Debian container là 1.82.3; test native ở đây xác nhận Gio và xử lý dữ liệu, không thay thế test Shell 51.

Sau khi các file sửa được dùng bởi phiên desktop, đăng xuất/đăng nhập để Shell nạp lại module, rồi kiểm tra:

1. Mở/đóng launcher, bật/tắt search và ẩn/hiện panel; thử cả hai thứ tự bật Just Perfection và Spotlight. Ô tìm kiếm không crash, không bị ẩn hoặc co lại trong launcher.
2. Rê chuột chậm qua ranh giới icon và rê nhanh qua lại trên dock; thử bốn cạnh, SVG/PNG, HiDPI, kéo icon và mở menu. Icon không nhảy kích thước/vị trí; click trúng icon được hiển thị.
3. Vuốt ba ngón liên tục rồi đảo chiều trước khi animation kết thúc; thử 2–3 workspace, nhiều monitor và tắt extension nền/blur giữa switch. Không còn pha nảy bổ sung; cửa sổ không giữ offset và input không bị kẹt.
4. Bật reduced motion/tắt animations, minimize/restore cửa sổ trong lúc đổi workspace; thao tác hoàn tất và không chạy Magic Lamp khi gesture đang hoạt động.
5. Khóa/mở khóa hoặc bật/tắt Tiling Assistant liên tục; copy nội dung rồi bật private mode/tắt Clipboard History ngay; nhập liệu và đổi ứng viên Kimpanel.

Có thể theo dõi lỗi trên máy desktop bằng:

```sh
journalctl --user -b -f -o cat | rg 'JS ERROR|TypeError|Gjs-CRITICAL|Clutter-CRITICAL|St-CRITICAL'
```
