# Đối chiếu Blur my Shell 74 — 07/10/2026

**Kết luận: giữ bản 74 và bổ sung các sửa lỗi còn cần thiết.** Không khôi phục
toàn bộ mã 72, vì upstream đã đổi API signal, pipeline, shader và thêm popup
blur. Patch bổ sung được tách riêng trong [blur-v74-local.patch](blur-v74-local.patch).

## Mốc đối chiếu

- Bản ban đầu: `8b4f467`, Blur my Shell 72.
- Bản đã sửa và dùng ổn định: HEAD `935a5d3`, gồm các sửa ở `d441311`.
- Bản cập nhật đang nằm trong workspace: metadata version **74**, hỗ trợ GNOME 50.
- Đã lưu nguyên trạng bản cập nhật trước khi sửa vào
  `/tmp/blur-v74-upstream-85wor2ur/blur-my-shell@aunetx`.

Theo [release của tác giả](https://github.com/aunetx/blur-my-shell/releases/tag/v74),
v74 phát hành ngày 05/10/2026. Nâng từ 72 lên 74 cũng nhận thay đổi của
[v73](https://github.com/aunetx/blur-my-shell/releases/tag/v73), gồm popup blur,
refraction và các sửa panel/dock. Những đánh giá dưới đây dựa trên source
thực tế trong workspace và regression, không chỉ dựa vào release notes.

## Những sửa cũ đã được upstream thay thế phù hợp

| Nhóm | Kết quả đối chiếu |
| --- | --- |
| Pooling effect | Chỉ tạo observer khi tạo effect; chuyển actor sẽ ngắt observer actor cũ. Không áp lại patch 72. |
| Connections | Dùng Map/Set và kiểm tra handler còn tồn tại; cập nhật mock theo API mới. |
| Static pipeline | Ngắt destroy handler trước khi rebind actor; giữ cách quản lý effect/override mới. |
| Native blur và scale | Dùng `unscaled_corner_radius`, normalize tên tham số cũ và chỉ gán corner radius khi thư viện hỗ trợ. Không cần setter tự thêm của bản 72. |
| Pipeline settings | Tách pack/unpack sang `pipeline_settings.js`, kiểm tra toàn bộ dữ liệu và reset rồi đọc lại default. Setter từ chối dữ liệu hỏng thay vì ghi một phần. |
| Clone pipeline | Clone effect và params khi duplicate; giữ implementation mới. |
| Shader | Downscale bảo vệ mẫu số/count; luminosity bảo vệ alpha bằng 0. Giữ GLSL mới. |
| Panel đa màn hình | So vị trí panel với tọa độ Y của monitor, thay cho giả định panel luôn ở Y=0. |
| App folders | Dùng transition của Clutter, dừng transition khi tháo effect và cleanup paint signals. Không khôi phục Tweener cũ. |
| Window list | Xóa pipeline bằng index đã tìm; regression qua trên upstream nguyên trạng. |

## Sửa bổ sung trên 74

Chỉ sửa **11 tệp runtime**, ghi trong patch riêng:

- Hủy restart timer của panel/applications và idle discovery của Dash to Panel
  khi disable, kể cả lúc component đang chờ bật lại.
- Theo dõi ID idle update của panel để hủy khi actor mất hoặc component tắt.
  Với geometry bằng 0 hoặc chưa có monitor, chờ notification tiếp theo thay
  vì tự lặp idle. Giữ việc defer update để tránh allocation race.
- Ngăn tracking/enable lặp; untrack các window cũ trước khi xây lại danh sách,
  gồm sticky window xuất hiện trên nhiều workspace. Cập nhật blur applications
  khi monitor thay đổi và guard actor/monitor đã mất trong lúc hotplug.
- Dummy pipeline gỡ effect và listener cũ trước khi attach lại.
- `update_pipeline_effects()` gửi descriptor cùng signal, để callback không
  dereference `undefined`. Cách clone của upstream được giữ nguyên.
- Screenshot chỉ cleanup background của selector bị hủy; disconnect listener
  cũ khi rebuild và hủy widget đã tháo, tránh ảnh hưởng màn hình khác.
- Lockscreen chấp nhận background hiện có không có `_bms_pipeline`.
- Khi tắt riêng overview blur, trả lại workspace hooks và tháo animation
  background khỏi UI group.
- Giới hạn divider/factor thành số nguyên 1–64, xử lý NaN/Infinity; shader mới
  vẫn được giữ nguyên.
- Paint callback vẫn chuyển tiếp native paint nếu callback repaint đã bị xóa.

Tất cả tệp upstream khác giữ nguyên byte so với snapshot: metadata, schema,
binary, bản dịch, preferences, CSS, popup blur, refraction và helper shader mới.
Không sửa extension khác, đổi settings, reload Shell hoặc commit trong lần này.

## Kiểm chứng

- **101/101** regression qua trên workspace sau bổ sung.
- Kiểm tra cú pháp **193 tệp JS** và cây import runtime của **10 extension** qua.
  Script hiện theo cả `export ... from`, nên kiểm tra được module popup mới.
- Parse thành công **13 tệp XML/UI** của Blur my Shell.
- Cùng bộ Blur/Magic Lamp **33** kiểm thử, với mock đã thích nghi API 74:
  upstream nguyên trạng **18 qua, 15 thất bại**; sau bổ sung **33/33 qua**.
  Đây là số trường hợp kiểm thử, không phải số lỗi độc lập.
- Popup blur mới qua kiểm thử hủy redraw/follow-up/reset khi disable; source
  popup được giữ nguyên.

Chạy kiểm tra với `node tests/check.mjs`. Node của devcontainer được ghi trong
[báo cáo ban đầu](extension-audit.md).

Patch bổ sung được kiểm tra riêng về whitespace và khả năng reverse-apply.
`git diff --check` toàn bộ workspace còn báo whitespace có sẵn trong cập nhật
upstream; không đổi các dòng đó để tránh tạo diff không liên quan.

Kiểm thử dùng mock GI/actor/timer. Container chưa có GJS/GNOME Shell hoặc GPU
Wayland của host; chưa xác nhận biên dịch GLSL, FPS hay hình ảnh của bản 74.
Schema XML và `gschemas.compiled` giữ nguyên bản upstream, không biên dịch lại.

Khi nạp lại bản này trên host, nên thử: mở/đóng popup panel, mở app folder,
chụp màn hình trên cả hai monitor, rút/cắm HDMI, và tắt Blur my Shell giữa một
lần đổi kiểu blur. Kiểm tra thêm minimize/unminimize với Magic Lamp vì ứng dụng
blur và opacity của animation cùng tác động lên actor cửa sổ.
