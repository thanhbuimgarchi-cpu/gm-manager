# Khởi động và chạy nền trên Windows

Bản cài Windows 1.1.0 có nút “Khởi động cùng Windows” cạnh nút thông báo. Đây là tùy chọn cho từng máy, dành cho mọi nhân viên; không nằm trong Thiết lập của admin. Bản web, bản cài dạng shortcut của trình duyệt, macOS và giao diện khách không hiện nút này.

Nút đọc trực tiếp thiết lập Windows khi mở ứng dụng, khi quay lại cửa sổ và khi thay đổi từ menu khay hệ thống. Chỉ hiện đã bật sau khi Windows xác nhận. Ứng dụng không tự bật tùy chọn khi cài hoặc khi chạy lần đầu. Khi đã bật, Windows mở ứng dụng với `--background` sau lần đăng nhập Windows tiếp theo.

Bản PC 1.2.1 sửa việc đọc nhầm trạng thái khởi động khi cài trong `C:\Program Files` hoặc tài khoản Windows có khoảng trắng. Đường dẫn executable được đặt trong dấu ngoặc kép cho cả lệnh đọc và ghi của Electron. Bản sửa vẫn tôn trọng mục bị tắt trong Ứng dụng khởi động; không tự bật lại thiết lập của người dùng.

Biểu tượng GM nằm ở khay hệ thống, có menu mở, ẩn, bật/tắt khởi động và thoát. Dấu X chỉ ẩn cửa sổ nếu biểu tượng khay đã tạo thành công; nếu khay lỗi, cửa sổ vẫn đóng bình thường. Chọn “Thoát GM Manager” đóng hẳn ứng dụng. Đăng xuất hoặc tắt Windows không bị cơ chế thu xuống khay chặn lại.

Cửa sổ ẩn vẫn giữ phiên đăng nhập và các lượt kiểm tra giao việc/thông báo. Nhấp biểu tượng, mở lại ứng dụng hoặc bấm thông báo sẽ hiện cửa sổ. Việc khởi động cùng Windows không thay thế lựa chọn bật thông báo của người dùng.

IPC thay đổi thiết lập chỉ nhận giá trị boolean từ khung chính của đúng đường dẫn ứng dụng GM Manager. Đường dẫn executable và tham số khởi động được cố định trong mã native.

`npm test` kiểm tra trạng thái Windows giả lập, quyền IPC và vòng đời khay. `npm run test:startup-ui` kiểm tra giao diện bằng dữ liệu và bridge giả lập. `npm run test:native-tray` kiểm tra Tray thật với runtime thử riêng, dữ liệu riêng và trang tĩnh; không sửa khởi động Windows hoặc dữ liệu CRM thật.

## Thông báo phiên bản PC mới

Giao diện kiểm tra bản PC khi mở ứng dụng, khi quay lại cửa sổ, khi có mạng trở lại và mỗi 60 giây, kể cả lúc chạy nền. Bản Windows chỉ có một nút “Cập nhật”: bấm nút kiểm tra và áp dụng bản mới, hoặc báo đang dùng bản mới nhất. Bản web/PWA vẫn tải lại phần giao diện khi có phiên bản web mới.

Từ PC 1.3.0, bấm “Cập nhật” tải bộ cài ngay trong ứng dụng, hiện phần trăm, kiểm tra kích thước và SHA256 rồi cài đặt và mở lại. Không tự tải hoặc cài khi chỉ kiểm tra định kỳ. Tệp tải chỉ nhận từ release GitHub của kho này và CDN HTTPS được cho phép. Mỗi lượt tải có thư mục riêng, tệp chưa hoàn chỉnh không được chạy; lỗi tải hoặc sai checksum giữ nguyên ứng dụng để thử lại.

Trước khi tải và ngay trước khi cài, giao diện phải xác nhận lưu cache/bản nháp. Biểu mẫu chưa lưu hoặc tác vụ đang chạy sẽ chặn khởi động lại với thông báo rõ ràng. Native kiểm tra lại tệp sau xác nhận, chạy NSIS với `--updated /S --force-run`, rồi thoát sau khi tiến trình cài khởi chạy. NSIS dùng GUID cũ để giữ thư mục và phạm vi cài; bản cài toàn máy có thể hiện yêu cầu UAC thông thường của Windows. Không dùng `/D` để tránh lỗi đường dẫn có khoảng trắng trong electron-builder 26.15.3.

Bản 1.0–1.2.1 chưa có API cài đặt nội bộ nên phải cài PC 1.3.0 một lần. Nút “Cập nhật” trên các bản này mở bộ cài và giải thích bước chuyển đổi; từ bản hỗ trợ trở đi cập nhật được thực hiện trong ứng dụng. Nếu còn giữ giao diện cũ, cần tải lại giao diện một lần. “Để sau” ẩn bảng nhắc, còn nút “Cập nhật” vẫn giữ. Thông báo Windows chỉ gửi khi đã bật thông báo, mỗi phiên bản một lần; bấm thông báo mở lại cửa sổ hiện tại.

Windows CI xuất bộ cài bất biến `GM-CRM-Setup-x.y.z.exe` và giữ tên `GM-CRM-Setup.exe` cho liên kết cũ. Mọi thay đổi native phải tăng `desktop/package.json.version`; chạy lại pipeline cùng phiên bản giữ nguyên bộ cài đã phát hành. Pipeline kiểm tra checksum và kích thước trước khi cập nhật liên kết cũ, không hạ liên kết về phiên bản thấp hơn.

Pages tạo `desktop-version.json` từ bộ cài đã tải lên hoàn chỉnh, có SHA256 và kích thước xác nhận trong release GitHub. Khi Windows CI thành công, Pages được triển khai lại để công bố bộ cài mới. PC chỉ đọc manifest tĩnh này, không dùng API GitHub theo từng máy; đường dẫn tải luôn bị giới hạn trong đúng kho GM Manager.

`npm run test:desktop-updates-ui` kiểm tra nút duy nhất, tiến độ, bản PC cũ, so sánh phiên bản, chặn lỗi lưu và tải theo thao tác bằng bridge giả lập. Unit test kiểm tra tải theo luồng, checksum, handoff và xác nhận bản nháp. Các kiểm thử không chạy bộ cài hoặc sửa thiết lập Windows thật.
