# Khởi động và chạy nền trên Windows

Bản cài Windows 1.1.0 có nút “Khởi động cùng Windows” cạnh nút thông báo. Đây là tùy chọn cho từng máy, dành cho mọi nhân viên; không nằm trong Thiết lập của admin. Bản web, bản cài dạng shortcut của trình duyệt, macOS và giao diện khách không hiện nút này.

Nút đọc trực tiếp thiết lập Windows khi mở ứng dụng, khi quay lại cửa sổ và khi thay đổi từ menu khay hệ thống. Chỉ hiện đã bật sau khi Windows xác nhận. Ứng dụng không tự bật tùy chọn khi cài hoặc khi chạy lần đầu. Khi đã bật, Windows mở ứng dụng với `--background` sau lần đăng nhập Windows tiếp theo.

Biểu tượng GM nằm ở khay hệ thống, có menu mở, ẩn, bật/tắt khởi động và thoát. Dấu X chỉ ẩn cửa sổ nếu biểu tượng khay đã tạo thành công; nếu khay lỗi, cửa sổ vẫn đóng bình thường. Chọn “Thoát GM Manager” đóng hẳn ứng dụng. Đăng xuất hoặc tắt Windows không bị cơ chế thu xuống khay chặn lại.

Cửa sổ ẩn vẫn giữ phiên đăng nhập và các lượt kiểm tra giao việc/thông báo. Nhấp biểu tượng, mở lại ứng dụng hoặc bấm thông báo sẽ hiện cửa sổ. Việc khởi động cùng Windows không thay thế lựa chọn bật thông báo của người dùng.

IPC thay đổi thiết lập chỉ nhận giá trị boolean từ khung chính của đúng đường dẫn ứng dụng GM Manager. Đường dẫn executable và tham số khởi động được cố định trong mã native.

`npm test` kiểm tra trạng thái Windows giả lập, quyền IPC và vòng đời khay. `npm run test:startup-ui` kiểm tra giao diện bằng dữ liệu và bridge giả lập. `npm run test:native-tray` kiểm tra Tray thật với runtime thử riêng, dữ liệu riêng và trang tĩnh; không sửa khởi động Windows hoặc dữ liệu CRM thật.

## Thông báo phiên bản PC mới

Giao diện kiểm tra bản PC khi mở ứng dụng, khi quay lại cửa sổ, khi có mạng trở lại và mỗi 60 giây, kể cả lúc chạy nền. “Cập nhật giao diện” tải lại phần web; “Cập nhật PC” tải bộ cài Windows theo số phiên bản. Bộ cài không tự chạy hoặc đóng công việc đang làm. Sau khi tải xong, người dùng thoát GM Manager, cài đè rồi mở lại.

Bản 1.2.0 đọc số phiên bản đã cài qua IPC. Bản 1.0/1.1 chưa có API này vẫn nhận bảng nhắc nâng cấp từ giao diện web; cần tải lại giao diện một lần nếu ứng dụng vẫn đang mở giao diện cũ. “Để sau” ẩn bảng nhắc cho phiên bản đó, còn nút tải trên đầu trang vẫn giữ. Thông báo Windows chỉ gửi khi người dùng đã bật thông báo, mỗi phiên bản một lần; bấm thông báo mở lại cửa sổ hiện tại.

Windows CI xuất bộ cài bất biến `GM-CRM-Setup-x.y.z.exe` và giữ tên `GM-CRM-Setup.exe` cho liên kết cũ. Mọi thay đổi native phải tăng `desktop/package.json.version`; chạy lại pipeline cùng phiên bản giữ nguyên bộ cài đã phát hành. Pipeline kiểm tra checksum và kích thước trước khi cập nhật liên kết cũ, không hạ liên kết về phiên bản thấp hơn.

Pages tạo `desktop-version.json` từ bộ cài đã tải lên hoàn chỉnh, có SHA256 và kích thước xác nhận trong release GitHub. Khi Windows CI thành công, Pages được triển khai lại để công bố bộ cài mới. PC chỉ đọc manifest tĩnh này, không dùng API GitHub theo từng máy; đường dẫn tải luôn bị giới hạn trong đúng kho GM Manager.

`npm run test:desktop-updates-ui` kiểm tra bảng nhắc cho bản PC cũ, so sánh phiên bản, nhắc lại sau trì hoãn, tải theo thao tác và thông báo bằng bridge giả lập, không cài phần mềm thật.
