# Khởi động và chạy nền trên Windows

Bản cài Windows 1.1.0 có nút “Khởi động cùng Windows” cạnh nút thông báo. Đây là tùy chọn cho từng máy, dành cho mọi nhân viên; không nằm trong Thiết lập của admin. Bản web, bản cài dạng shortcut của trình duyệt, macOS và giao diện khách không hiện nút này.

Nút đọc trực tiếp thiết lập Windows khi mở ứng dụng, khi quay lại cửa sổ và khi thay đổi từ menu khay hệ thống. Chỉ hiện đã bật sau khi Windows xác nhận. Ứng dụng không tự bật tùy chọn khi cài hoặc khi chạy lần đầu. Khi đã bật, Windows mở ứng dụng với `--background` sau lần đăng nhập Windows tiếp theo.

Biểu tượng GM nằm ở khay hệ thống, có menu mở, ẩn, bật/tắt khởi động và thoát. Dấu X chỉ ẩn cửa sổ nếu biểu tượng khay đã tạo thành công; nếu khay lỗi, cửa sổ vẫn đóng bình thường. Chọn “Thoát GM Manager” đóng hẳn ứng dụng. Đăng xuất hoặc tắt Windows không bị cơ chế thu xuống khay chặn lại.

Cửa sổ ẩn vẫn giữ phiên đăng nhập và các lượt kiểm tra giao việc/thông báo. Nhấp biểu tượng, mở lại ứng dụng hoặc bấm thông báo sẽ hiện cửa sổ. Việc khởi động cùng Windows không thay thế lựa chọn bật thông báo của người dùng.

IPC thay đổi thiết lập chỉ nhận giá trị boolean từ khung chính của đúng đường dẫn ứng dụng GM Manager. Đường dẫn executable và tham số khởi động được cố định trong mã native.

`npm test` kiểm tra trạng thái Windows giả lập, quyền IPC và vòng đời khay. `npm run test:startup-ui` kiểm tra giao diện bằng dữ liệu và bridge giả lập. `npm run test:native-tray` kiểm tra Tray thật với runtime thử riêng, dữ liệu riêng và trang tĩnh; không sửa khởi động Windows hoặc dữ liệu CRM thật.
