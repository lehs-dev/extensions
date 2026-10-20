# Kết quả tiếp quản GNOME 51 / macOS Sequoia

## Dải workspace thu gọn và giãn đều hai phía — 18/10/2026

Dải nền bắt đầu bằng nửa chiều rộng work area của monitor chính, luôn căn
giữa và giữ kích thước thumbnail hiện tại. Thêm workspace làm nền giãn đều
sang hai phía; xóa workspace thu nền theo animation native. Khi nền đã đạt
chiều rộng tối đa, thumbnail co vừa phần còn lại, có tính spacing và padding
của theme, tránh tràn thumbnail và viền chọn ở hai đầu.

Đã bổ sung regression cho 9/12 workspace, đổi độ phân giải/scale, thêm/xóa
workspace và độ đối xứng của nền. **225/225 Node tests PASS**, native GJS/Gio
PASS; syntax/schema check: **199 JavaScript files, 8 schema directories,
0 failures**; `git diff --check` PASS. Chưa kiểm tra trực quan trong GNOME Shell.

## Sửa App Grid không nhận hover/click

Lớp `WorkspacesDisplay` nằm trên `AppDisplay` và được mở rộng để giữ vị trí
cửa sổ khi fade. Ẩn riêng primary view không tắt khả năng nhận input của lớp
cha; các actor trong suốt cũng vẫn có thể được Clutter chọn làm đích chuột.
Vì vậy icon vẫn hiện nhưng hover/click bị lớp workspace chặn.

Đã dùng [API native `Shell.util_set_hidden_from_pick`](https://github.com/GNOME/gnome-shell/blob/51.0/src/shell-util.c)
để loại toàn bộ cây workspace chính khỏi hit-test khi tiến độ Overview lớn
hơn Window Picker, gồm cả DND. Khi vuốt ngược về Window Picker hoặc disable,
hook này được gỡ và cache picking được làm mới qua redraw. Native search
reactivity và workspace trên monitor phụ tiếp tục do Shell quản lý.

Fixture test nay mô phỏng đúng thứ tự lớp native, parent `reactive: true` và
việc hide primary child. Ba regression mới kiểm tra icon/folder/page control,
actor con trong lúc fade, đảo gesture, native search writes, monitor phụ và
disable/re-enable. Source trước bản sửa: **23/26 PASS, 3 FAIL** đúng các ca
mới; source sửa: **26/26 PASS**. Chưa xác minh trực tiếp trong phiên GNOME.

## Rà soát bổ sung đường chạy touchpad

Người dùng xác nhận chưa gặp crash ở thời điểm rà soát. Các thay đổi dưới đây
sửa những lỗi logic tái hiện bằng test; chưa xác nhận chúng là nguyên nhân
của một crash compositor trên thiết bị thật.

- **Overview:** cấp geometry thumbnail ngay trong allocation native, bỏ lần
  allocate thứ hai có thể làm đích scale đổi qua lại khi nhiều workspace.
  Dùng chiều cao Dock của frame hiện tại; callback post-allocation và signal
  cũ không truy cập actor sau disable hoặc sau một chu kỳ enable mới.
- **Magic Lamp:** tránh chạy hiệu ứng trong toàn bộ vòng đời đổi workspace,
  gồm lúc ngón tay còn giữ trên touchpad. Hiệu ứng đang chạy dừng và phục hồi
  actor/completion đúng một lần khi workspace animation bắt đầu.
- **Blur my Shell:** paint callback đã dọn không còn bị gọi; cleanup hủy cả
  widget chứa wallpaper và wallpaper cũ đang fade. Đổi thứ tự lớp nền bằng
  restack, tránh gỡ/gắn lại actor khi chrome được thêm trong Overview.
- **Tiling Assistant:** hủy timer focus hint bị thay thế khi đổi workspace
  liên tiếp, dọn timer static hint khi ngắt animation, và giữ hook của extension
  khác hoạt động khi disable/re-enable.
- **Bộ test:** xóa test riêng của Window Gap đã bị gỡ khỏi repo, chuyển test
  schema/gap sang Tiling Assistant hiện tại. Giữ kiểm tra work area có strut,
  monitor tọa độ âm và gap theo logical coordinates ở scale 100/125/200%.

Đã đối chiếu các implementation native của
[ControlsManagerLayout](https://github.com/GNOME/gnome-shell/blob/51.0/js/ui/overviewControls.js),
[ThumbnailsBox](https://github.com/GNOME/gnome-shell/blob/51.0/js/ui/workspaceThumbnail.js),
[workspace animation](https://github.com/GNOME/gnome-shell/blob/51.0/js/ui/workspaceAnimation.js)
và [BackgroundManager](https://github.com/GNOME/gnome-shell/blob/51.0/js/ui/background.js).
Các regression mới cho allocation, callback muộn, cleanup và timer/hook đã
được chạy với source cũ trong thư mục tạm: FAIL đúng lỗi; source sửa PASS.

Kết quả hiện tại thay thế số liệu của các lần nghiệm thu cũ bên dưới:

- **221/221 Node tests PASS**, gồm các ca App Grid nhận input, 100 lần đảo chiều/đổi workspace,
  gesture đang giữ ngón tay, animation bị ngắt và disable/re-enable.
- Native GJS/Gio clipboard regression PASS.
- `node scripts/check.mjs`: **199 JavaScript files, 8 schema directories,
  0 failures**; `git diff --check` PASS.
- Chưa có phiên GNOME Shell/Mutter 51, GPU hoặc touchpad trong container.
  Cần kiểm tra trên desktop: vuốt lên/xuống dở rồi đảo chiều, vuốt ngang liên
  tiếp, minimize/restore trong lúc giữ gesture, nhiều monitor và thay đổi scale.

## Overview kiểu Mission Control

Static Workspace Background nay thêm wallpaper toàn màn hình trong Overview,
ẩn riêng nền thu nhỏ của native workspace. Cửa sổ đang minimize fade tại slot
Overview, không còn bay ra từ góc trái trên. Dải workspace native xuất hiện phía
trên Window Picker ngay lần Super đầu tiên; App Grid không còn chứa dải này.
Thumbnail giảm 15% (160→136 px ở scale 100%), cách panel 8 px thay vì 24 px;
dải nền phủ hết chiều ngang monitor chính và fade/ẩn theo thumbnail native.
Dải nền và thumbnail sổ xuống từ dưới panel theo tiến độ Overview (Super và
vuốt ba ngón), đảo chiều khi hủy gesture; clip không cho vẽ đè lên panel.
Bo góc dải nền dùng chung 24 px với App Grid.
Overview đứng yên chỉ hiện cửa sổ của workspace đang chọn, tránh cửa sổ hai
workspace bên cạnh lẹm vào mép. Chuyển sang App Grid giữ nguyên geometry, chế độ
SINGLE và bố cục cửa sổ của Window Picker, rồi fade riêng actor workspace; không
gom cửa sổ lên hàng thumbnail. Vuốt ngang, kéo cửa sổ và opacity tìm kiếm native
được giữ; disable khôi phục ngay fit mode, bố cục, visibility và opacity.
Just Perfection Startup Status = Desktop chặn riêng animation Overview lúc
đăng nhập. Nếu GNOME đã bắt đầu animation trước khi extension nạp xong, che
Overview và kết thúc native hide ngay sau allocation đầu để trả lại desktop;
không sửa capability của session hay chặn Super sau khi startup hoàn tất.
Panel App Grid bo góc dùng tint trắng giống tiling preview, opacity 20% so với
12% của preview theo phản hồi muốn trong hơn, chỉ đậm thêm một chút. Ở
1920×1200, scale 100%, panel tối đa 1400×960. Cửa sổ, thumbnail và ứng dụng vẫn
là actor native; các hook bố cục nối tiếp Just Perfection và được khôi phục khi
disable. Hướng dẫn nạp source và kiểm tra desktop nằm trong
`static-workspace-background@custom/README.md`.

Xác minh lần thay đổi này:

- **45/45** test Overview, cửa sổ minimize, hình học, workspace và desktop spaces PASS;
  **25/25** test Just Perfection, gồm startup sớm/muộn, allocation, animation
  bị hủy và khôi phục sau disable PASS.
- Toàn bộ Node suite: **205/207 PASS**. Hai lỗi còn lại là test tham chiếu
  `window-gap@amirhosseinkarimi.github.io` đã không còn trong repo; đã chạy lại
  đúng hai test trên bản `HEAD` trước thay đổi và xác nhận cùng lỗi ENOENT.
- Native GJS/Gio clipboard regression PASS.
- `node scripts/check.mjs`: **197 JavaScript files, 8 schema directories,
  0 failures**; `git diff --check` PASS.
- Chưa chạy trực quan trong GNOME Shell/Wayland. Animation, kéo thả, app folder,
  nhiều monitor và chất lượng hình ảnh vẫn cần nghiệm thu trên desktop thật.

Ngày: 16/10/2026. Tiếp tục trên working tree của Antigravity; giữ các thay đổi đã có.

Cập nhật 17/10/2026: bỏ shader cưỡng chế bo góc cửa sổ và workaround constraint nhằm giữ góc bo của Tiling Assistant theo yêu cầu người dùng; khôi phục tile edge constraint và maximize từng trục bình thường, để ứng dụng và GNOME quyết định hình dạng góc. Bảng nghiệm thu bên dưới ghi lại lần chạy ngày 16/10/2026.

Kiểm tra sau khi bỏ shader 17/10/2026: **151/151 Node tests PASS**, native GJS/Gio PASS, `node scripts/check.mjs` kiểm tra **192 JavaScript files, 9 schema directories: 0 failures**, `git diff --check` PASS. Các test chỉ dành cho shader và listener đã gỡ được xóa; các test hình học và trạng thái tile được giữ và cập nhật. Chưa kiểm tra trực quan trên GNOME thật.

Cập nhật khoảng cách cạnh panel 17/10/2026: thêm Panel Edge mặc định 0, nhận diện vị trí panel trên đúng màn hình và đưa bốn cạnh tùy chỉnh ra phần Gaps. Với Screen Edges = 10, màn hình có panel dùng 0 ở cạnh sát panel và 10 ở ba cạnh còn lại; màn hình không có panel giữ 10 ở cả bốn cạnh. Custom Screen Edges mặc định chỉ áp dụng cho màn hình có panel; cấu hình tùy chỉnh cũ giữ phạm vi trước đó. Tile, preview và resize dùng chung cách tính. **159/159 Node tests PASS**, native GJS/Gio và kiểm tra Gio thật cho schema/migration PASS, **193 JavaScript files, 9 schema directories: 0 failures**, `git diff --check` PASS. XML preferences đã được kiểm tra; chưa chạy GtkBuilder hoặc kiểm tra trực quan vì container thiếu Gtk/Adw và GNOME Shell.

## Phần đã triển khai

| Extension | Kết quả |
| --- | --- |
| Dash2Dock Lite | Cosine bell, animation theo `Clutter.Timeline` và thời gian frame thực, dừng clock khi nghỉ; viền 1px, chấm running 4px, separator, theme sáng/tối và đồng bộ với session color scheme. Màu người dùng lưu được giữ nguyên. |
| Magic Lamp | Ưu tiên icon dock trực tiếp trước geometry cache; không tạo đích giả khi thiếu icon. Đầu phễu thắt còn tối đa 1 stage unit ở giữa cạnh icon hướng về cửa sổ; thu/phục hồi đảo ngược chính xác, không gập lưới. Thiếu đích hợp lệ thì co 6% và fade tại cửa sổ trong tối đa 160ms. Giữ opacity và cleanup snapshot khi đi qua nhiều monitor. |
| Spotlight | Bỏ blur/dim toàn màn hình; panel gọn, theme sáng/tối và kích thước theo monitor/scale. Sửa chuyển phím vào ClutterText, trạng thái search-active, kích hoạt kết quả bằng chuột/phím, focus menu ngữ cảnh và fade khi đóng. Giữ mở/focus đồng bộ và cleanup khi disable. |
| Tiling Assistant | Chọn được năm preset 1/3–2/3 từ layout picker; mười shortcut có hàng cấu hình trong preferences. Góc cửa sổ do ứng dụng và GNOME quyết định; đã bỏ shader bo góc 15 stage units và workaround constraint nhằm giữ góc bo, khôi phục tile edge constraint và maximize từng trục bình thường. Không nhân monitor scale thêm vào gap trong hệ tọa độ stage. |
| Window Gap | Outer margin mặc định 12px, inner gap của Tiling Assistant mặc định 12px, screen gap bổ sung bằng 0; không cộng đôi struts. |
| Blur my Shell | Giữ native blur mặc định và pooling khi đang chạy; khi disable, gỡ signal scale/actor và dispose toàn bộ effect đang dùng hoặc nằm trong pool. |
| Static Workspace Background | Giữ implementation nền tĩnh và animation native. Bổ sung kiểm tra hook wallpaper/blur theo cả hai thứ tự bật và disable giữa chuyển workspace. |
| Just Perfection | Giữ các sửa tương thích GNOME 51 trước đó; chạy lại regression cho search widget bị reparent và lifecycle. |
| Clipboard History | Giữ các sửa vòng đời trước đó; chạy lại regression và test GJS/Gio thật cho UTF-8, migration, persistence và phục hồi log bị cắt. |
| Kimpanel | Giữ implementation hiện tại; chạy lại regression thay đổi ứng viên và tránh refresh thừa. |
| Light Style | Giữ extension nguồn; Dock và Spotlight nay nhận notification của St và đọc session color scheme, thay vì chỉ theo khóa interface. Test tích hợp dùng module Light Style thật. |

Cache `gschemas.compiled` đi kèm được biên dịch lại. `scripts/check.mjs` nay kiểm tra cache khớp XML, ngoài syntax, metadata và schema strict; tránh trường hợp XML hợp lệ nhưng runtime không thấy khóa mới.

## Cấu hình sử dụng

- Spotlight mặc định `Ctrl+Space`; có thể chọn `Super+Space` trong preferences. Tab/Shift+Tab giữ cơ chế focus native của kết quả tìm kiếm; không thêm cơ chế hoàn thành lệnh riêng.
- Các shortcut thirds mặc định chưa gán để tránh chiếm phím đang dùng. Có thể đặt chúng trong preferences hoặc chọn trực tiếp từ layout picker khi kéo cửa sổ.
- Trong Tiling Assistant → Gaps, giữ Screen Edges = 10 và Panel Edge = 0 để bỏ riêng khe hở sát panel. Bật Custom Screen Edges để chỉnh Top/Left/Right/Bottom; giữ Only on Displays with a Panel để màn hình phụ không có panel tiếp tục dùng Screen Edges đồng đều.
- Các thay đổi default chỉ áp dụng cho khóa chưa có giá trị người dùng lưu. Với cấu hình cũ, đặt Window Gap outer margin và Tiling Assistant inner gap bằng 12 để dùng preset này; để screen gap của Tiling Assistant bằng 0 khi đã dùng outer struts.

## Giới hạn xác minh

Container có Node, GJS/Gio và GLib, nhưng không có GNOME Shell/Mutter 51, phiên Wayland, GPU hay touchpad. Test Node chạy source extension thật với adapter ở biên GI/Shell; chúng xác nhận logic, dữ liệu hình học và cleanup, không đo frame time hoặc chất lượng shader trên GPU.

Spotlight chỉ giữ actor trong suốt để nhận click ngoài popup; không làm mờ hoặc dim desktop. Test kiểm tra không tạo blur effect và không tô nền actor này. Chưa có số đo chứng minh input <16ms hay không drop frame ở 60/120Hz, và chưa xác nhận trực quan thiết kế mới trong phiên GNOME thật.

Ở lần nghiệm thu 16/10/2026, đã bỏ assertion tự đặt thuộc tính rounded-corner lên mock rồi gọi đó là test tích hợp. Kiểm tra wallpaper tìm đúng background actor; các corner test khi đó kiểm tra effect lifecycle/uniform/snippet riêng của shader nay đã được bỏ.

## Kiểm tra desktop còn cần thực hiện

Sau khi đưa source/schema mới vào thư mục extension đang dùng, đăng xuất/đăng nhập phiên Wayland để Shell nạp lại module.

1. Rê chuột chậm/nhanh qua Dock; thử 60/120Hz, fractional scaling, bốn cạnh và autohide. Thu nhỏ/phục hồi liên tiếp, gồm cửa sổ và Dock ở hai monitor khác nhau.
2. Bấm nhanh shortcut Spotlight; gõ ngay khi popup bắt đầu mở, thử chữ Unicode, Backspace, mũi tên, Tab/Shift+Tab, Space/Enter trên kết quả và disable khi đang mở. Giữ chuột trên kết quả rồi thả để kích hoạt, thử menu chuột phải và mở khi Overview đang hiển thị. Bật/tắt Light Style trong lúc popup mở; desktop phải giữ nguyên độ rõ/sáng.
3. Snap nửa, góc, thirds và two-thirds; kiểm tra khoảng hở và shadow với ứng dụng GTK/Qt/XWayland ở 100%, 125% và 200%. Góc cửa sổ phải giữ hình dạng do ứng dụng và GNOME quyết định khi tile, maximize, fullscreen và restore.
4. Vuốt workspace rồi đảo chiều liên tục; thử nhiều monitor, bật/tắt blur/nền tĩnh giữa gesture, reduced motion và khóa/mở khóa phiên.
5. Theo dõi lỗi trong phiên desktop:

```sh
journalctl --user -b -f -o cat | rg 'JS ERROR|TypeError|Gjs-CRITICAL|Clutter-CRITICAL|St-CRITICAL'
```

## Cơ sở API đã đối chiếu

- [Hướng dẫn port GNOME Shell 51](https://gjs.guide/extensions/upgrading/gnome-shell-51.html): `Cogl.Snippet`, API bị bỏ và `disable()` đồng bộ.
- [Clutter Timeline.get_delta](https://mutter.gnome.org/clutter/method.Timeline.get_delta.html): thời gian tính bằng milliseconds trong `new-frame`.
- [Shell 51 native blur](https://raw.githubusercontent.com/GNOME/gnome-shell/51.0/src/shell-blur-effect.c): adaptive downscale, cache trong actor mode và chi phí background mode.

## Kết quả nghiệm thu tự động ngày 16/10/2026

| Kiểm tra | Kết quả |
| --- | --- |
| `node --experimental-vm-modules --test tests/*.test.mjs` | **160/160 pass**, 0 fail, 0 skipped |
| `node scripts/test-native.mjs` | PASS: GJS/Gio UTF-8 migration, persistence, truncated-log recovery |
| `node scripts/check.mjs` | **194 JavaScript files, 9 schema directories: 0 failures**; cache khớp XML |
| Native Gio đọc cache đã compile | PASS: 10 shortcut thirds, inner/outer default 12 và additional outer gap 0 |
| libxml2 đọc preferences/SVG đã sửa | **9 files: 0 failures**; kiểm tra XML well-formed, không thay thế GtkBuilder runtime |
| `git diff --check` | PASS |

Các kết quả trên được ghi nhận trước thay đổi bỏ cưỡng chế bo góc ngày 17/10/2026. Các tiêu chí desktop ở trên còn chờ chạy trên GNOME 51 thật; chưa xác nhận frame pacing hay input latency.
