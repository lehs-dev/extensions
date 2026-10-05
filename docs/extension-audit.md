# Rà soát extension GNOME

Môi trường xác nhận ngày 03/10/2026: GNOME 50.x, Wayland; màn hình rời
1900×1080 là primary, laptop 1900×1200; cả hai scale 100%. Rút HDMI sẽ chuyển
primary sang laptop. Kích thước này theo thông tin người dùng, chưa đo từ host.

`/workspaces/extensions` được bind mount trực tiếp từ
`/home/lehoangson/.local/share/gnome-shell/extensions`. Mốc ban đầu là commit
`8b4f467`. Khi tiếp tục kiểm chứng ngày 05/10/2026, các bản sửa đã có trong
commit `d441311`; phần bổ sung kiểm thử và báo cáo vẫn là diff chưa commit.
Không bật/tắt extension, đổi GSettings, reload Shell hay đăng xuất phiên host
trong quá trình rà soát.
Thư mục `.devcontainer/` có sẵn và không được sửa.

## Phạm vi và kết quả

Đã đọc mã JavaScript của cả 10 extension, gồm runtime, helper và preferences;
đối chiếu metadata, schema và các shader liên quan. Bản dịch, ảnh và resource
nhị phân không được coi là mã đã kiểm tra bằng runtime.

| Extension | Bản cài | JavaScript | Thay đổi chính |
| --- | --- | ---: | --- |
| Blur my Shell | 72 | 50 | Ngắt observer khi tái sử dụng effect/pipeline; tránh theo dõi cửa sổ lặp; hủy timer/idle khi disable; cleanup screenshot theo từng màn hình; guard monitor/actor đã mất; sửa shader chia cho 0; giữ bán kính logic qua đổi scale và phục hồi pipeline hỏng bằng default đã giải mã. |
| Compiz alike magic lamp effect | 24 | 3 | Dừng timeline khi bị ngắt; cleanup effect một lần; bảo vệ kích thước và mẫu số; bỏ redisplay dock mỗi lần minimize; snapshot tạm khi animation đi qua màn hình khác; giữ wrapper của extension khác và vô hiệu hóa wrapper cũ sau disable. |
| Dash2Dock Animated | 92 | 28 | Sửa biến monitor không tồn tại, tạo dock lặp, lựa chọn monitor và cleanup actor/listener/timer; theo dõi cửa sổ riêng cho từng dock; đọc Downloads bất đồng bộ và hủy được. |
| Just Perfection | 37 | 7 | Sửa ID signal cũ bị ngắt lại; cân bằng block/unblock phím Super; giữ handler attention của Shell; khôi phục startup state; guard lúc không có màn hình. |
| Input Method Panel / Kimpanel | 92 | 6 | Dùng `Rectangle.width/height`; sửa `self` không tồn tại và so sánh cursor; kiểm tra scale; giữ menu item khi cập nhật properties; guard popup lúc mất monitor. |
| Light Style | 28 / 50.4 | 1 | Đã rà soát; không thấy lỗi cụ thể cần sửa trong mã chuyển/khôi phục color scheme. |
| Search Light | 42 | 14 | Không import Gdk trong Shell; trả lại actor search cho Overview khi disable; khôi phục override và cân bằng compositor inhibit; cleanup signal/actor; cập nhật monitor. |
| Static Workspace Background | 11 / 50.1 | 2 | Khôi phục wallpaper/style khi disable; kết thúc callback switch đang chạy; tránh callback lặp và tham chiếu prototype đã xóa; không để background khác bị ẩn vĩnh viễn. |
| Tiling Shell | 76 / 17.3 | 61 | Theo dõi đầy đủ signal trùng tên; cleanup drag/first-frame/Alt+Tab/editor; bỏ kết quả smart-radius cũ; cập nhật khi monitor đổi dù số lượng không đổi; sửa monitor index 0 và tọa độ âm. |
| Window Gap | 2 | 3 | Tái sử dụng chrome actor khi chỉnh gap/monitor; gỡ actor dư khi tháo màn hình; giữ work area dương trên màn hình nhỏ. |

## Animation từ màn hình phụ về dock trên primary

Theo triệu chứng được báo, hướng đích đã đúng nhưng hình biến dạng bị cắt ở
màn hình gốc; Firefox là ngoại lệ. Mã Mutter cho thấy Wayland surface và vùng
vẽ của actor có thể làm kết quả khác nhau giữa ứng dụng. Đây là chẩn đoán từ
mã nguồn, chưa phải kết luận từ trace của phiên host.

Magic Lamp hiện dùng một texture snapshot trong `Main.uiGroup` khi cửa sổ và
icon nằm trên hai monitor khác nhau. Snapshot giữ vị trí/kích thước ban đầu;
hiệu ứng dùng actor này và báo hoàn tất cho actor cửa sổ thật. Khi kết thúc,
bị thay thế, cửa sổ đóng hoặc extension tắt, timeline dừng, snapshot được hủy
và opacity cửa sổ được trả lại. Lỗi tạo snapshot cũng có đường hoàn tất để
không giữ cửa sổ ẩn. Cùng màn hình tiếp tục dùng actor trực tiếp.

Khi effect bị gỡ trực tiếp, callback native `set_actor(NULL)` chạy trước khi
Mutter xóa effect khỏi danh sách. Cleanup snapshot được trì hoãn bằng idle
có quản lý để tránh giải phóng danh sách trong lúc native đang dùng nó;
disable và cửa sổ bị đóng sẽ hủy idle rồi hoàn tất cleanup. Kiểm thử mô phỏng
thứ tự callback này, ngoài các đường kết thúc animation thông thường.

Các hook Shell giữ hàm gốc trong closure và trạng thái riêng cho từng lần
enable. Khi disable, chỉ khôi phục hook còn do Magic Lamp sở hữu; wrapper
được extension khác giữ lại sẽ chuyển tiếp đến hàm gốc, tránh `TypeError`
hoặc nuốt callback hoàn tất. Effect đang chạy giữ callback completion riêng.

Snapshot chỉ được tạo một lần cho mỗi animation qua màn hình. Chưa đo FPS,
chi phí GPU hay bộ nhớ trên máy thật; cần kiểm tra trực tiếp cả minimize và
unminimize với ứng dụng từng gặp lỗi.

Đối chiếu:
[Mutter 50 Clutter actor: paint/culling/redraw](https://raw.githubusercontent.com/GNOME/mutter/50.0/clutter/clutter/clutter-actor.c),
[GNOME Shell 50 window manager](https://raw.githubusercontent.com/GNOME/gnome-shell/50.0/js/ui/windowManager.js).

## Bo góc khi phóng to trong ảnh

Window Gap chỉ tạo strut để thu nhỏ work area; ứng dụng vẫn nhận trạng thái
`maximized`. GTK mặc định bỏ bo góc ở trạng thái này. Tiling Shell có thể tạo
cửa sổ lớn ở trạng thái không maximized khi tile, nên diện mạo khác nhau.

Không sửa CSS của ứng dụng, không tự chuyển maximize thành unmaximize và
không thêm một extension/shader bo góc mới trong bản rà soát này. Vì vậy,
bo góc khi **vẫn maximized** chưa được thay đổi. Muốn giữ bo góc độc lập với
Tiling Shell cần thêm cơ chế mask hoặc đổi cách quản lý trạng thái cửa sổ;
đó là thay đổi hành vi riêng cần kiểm tra với các ứng dụng thực tế.

Nguồn về hành vi GTK:
[On windows and titlebars — GNOME](https://blogs.gnome.org/alicem/2020/04/12/on-windows-and-titlebars/).

Nếu cùng bật Window Gap và outer gap của Tiling Shell, hai lớp có thể cùng
chừa mép: Tiling Shell nhận work area đã bị Window Gap thu nhỏ rồi áp dụng
gap của nó. Cấu hình của người dùng chưa bị thay đổi.

## Kiểm chứng

Chạy từ root repository với Node sẵn trong VS Code hoặc Node cài riêng:

```sh
node tests/check.mjs
```

Trong devcontainer hiện tại, executable có tại:

```sh
/vscode/vscode-server/bin/linux-alpine/07f806f999227108933c2e30515b26eecc1fda74/node tests/check.mjs
```

Script kiểm tra cú pháp 175 file JavaScript, metadata tương thích GNOME 50,
cây import runtime của cả 10 extension và chạy các bộ kiểm thử hồi quy.
Kiểm thử dùng mock signal, timer, actor và D-Bus để tái hiện đường lỗi; không
khởi chạy GNOME Shell. Schema XML được parse riêng bằng Python; schema và
`gschemas.compiled` không được sửa nên không cần biên dịch lại.

Kết quả cuối ngày 05/10/2026: **87/87 kiểm thử qua** trên bản đã sửa; trên
commit ban đầu trong `/tmp`, **86/87 kiểm thử thất bại**, 1 kiểm thử vẫn qua. Kiểm tra cú
pháp 175 file và cây import 10 extension đều qua. Parse thành công 33 file
schema/UI XML có sẵn trong repository; `git diff --check` sạch.

Các quy tắc cleanup và tránh thư viện GTK trong compositor được đối chiếu
với [hướng dẫn review của GNOME](https://gjs.guide/extensions/review-guidelines/review-guidelines.html).

## Kiểm tra trên phiên GNOME thật

Container chưa có GJS/GNOME Shell hoặc D-Bus session của host; chưa kiểm tra
GPU/Wayland thật. Mã mới cần phiên Shell mới để được nạp đầy đủ. Với Wayland,
lưu công việc rồi đăng xuất/đăng nhập vào lúc phù hợp.

1. Mở cửa sổ ứng dụng từng gặp lỗi trên laptop, giữ dock ở màn hình rời.
   Nhấp icon để minimize rồi mở lại; hình phải đi qua ranh giới hai màn hình,
   cửa sổ không bị ẩn hoặc kẹt sau animation. So sánh thêm Firefox.
2. Thử hai chiều di chuyển, dock trên từng monitor, cửa sổ sát mép màn hình;
   ngắt animation bằng thao tác nhanh hoặc mở Overview.
3. Rút/cắm HDMI và đổi primary khi vẫn giữ hai monitor. Dock, Search Light,
   layout Tiling Shell và popup nhập liệu phải dùng geometry mới.
4. Mở/đóng Search Light rồi dùng search trong Overview. Tắt/bật các extension
   để kiểm tra actor/signal cũ không còn hoạt động. Riêng Static Workspace
   Background, kiểm tra tắt giữa animation không giữ modal grab.
5. Chụp màn hình nhiều monitor, dùng Kimpanel gần mép dưới màn hình laptop;
   theo dõi log lỗi Shell và kiểm tra UI không bị mất sau thao tác.

Xem log trên host bằng `journalctl --user -b`; không coi việc thiếu log lỗi
là phép đo hiệu năng. Có thể xem/revert từng nhóm diff trong Source Control
của VS Code theo mốc `8b4f467`. Không chạy reset/revert tự động trong audit.

## Giới hạn

Đây là sửa lỗi có bằng chứng từ source và kiểm thử hồi quy, chưa phải xác
nhận loại bỏ mọi crash hoặc stutter. Tương tác giữa prototype override của
các extension, shader compilation và cập nhật upstream vẫn cần kiểm tra
trong Shell thật. Bản cập nhật extension từ upstream có thể ghi đè các sửa
cục bộ; giữ diff/commit trước khi cập nhật.

GLSL được rà soát bằng source; container chưa có compiler shader và chưa
kiểm chứng việc biên dịch trên driver GPU của host.

Phần recents của Dash2Dock đang bị vô hiệu hóa còn có API async/temporary-file
cần rà thêm nếu bật lại tính năng đó. Chưa thay đổi những đường không chạy
này để tránh mở rộng hành vi của bản sửa.
