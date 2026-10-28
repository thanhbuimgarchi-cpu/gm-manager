# Luồng giao việc

Ghi chú, thiết kế và giao việc từ tin nhắn dùng `workflow-command`. Mỗi yêu cầu chỉ thay đổi một công việc, thay cho việc gửi lại cả danh sách từ trình duyệt.

Phát hành, sửa, nhận và xóa ghi chú gửi một lệnh, không đọc lại toàn bộ danh sách trước khi ghi và không ghi lại workspace của các khách khác. Dự án đã có cache không nạp lại lịch sử Drive trên đường xử lý này; dữ liệu cũ chưa nạp được có nút thử riêng. Giao diện hiện nội dung đang phát hành ngay khi đã giữ yêu cầu trên thiết bị.

- Máy chủ xác thực phiên đăng nhập, kiểm tra lại nhân viên đang hoạt động và quyền hiện tại.
- Người tạo được sửa/xóa ghi chú chưa hoàn thành; người phụ trách được nhận và hoàn thành việc. Chỉ admin/quản lý giao việc từ tin nhắn.
- Ngày hoàn thành và thời điểm nhận việc do máy chủ ghi theo giờ Việt Nam. Ngày dự kiến mới phải là hôm nay hoặc tương lai.
- Mỗi yêu cầu có mã cố định khi gửi lại. Revision ngăn bản cũ ghi đè thay đổi mới; tombstone ngăn ghi chú đã xóa xuất hiện lại.

## Mất mạng và xung đột

Trước khi gửi, trình duyệt giữ ý định thay đổi vào hàng đợi riêng cho tài khoản, kết nối và dự án. Hàng đợi không lưu token. Mỗi yêu cầu dùng một khóa lưu trữ riêng để các tab không ghi đè nhau.

Giao diện chỉ cập nhật trạng thái đã phát hành/nhận/hoàn thành sau phản hồi xác nhận. Lỗi mạng hoặc lỗi máy chủ tạm thời được gửi lại có giới hạn. Lỗi quyền, dữ liệu và xung đột được giữ trong mục “Có thay đổi cần kiểm tra”; người dùng có thể đăng nhập lại, thử lại hoặc hủy yêu cầu.

Feed công việc mang revision theo dự án và snapshot của dự án đang mở. Một lần cập nhật này đồng thời làm mới sidebar và nội dung ghi chú, kể cả việc hoàn thành, xóa hay giao lại trên thiết bị khác; không tạo thêm lượt tải riêng để làm mới editor.

## Lưu trữ

Dữ liệu hoạt động dùng cache chia sẻ của Apps Script. Các khối JSON được chia theo số byte UTF-8; con trỏ chỉ đổi sau khi ghi xong toàn bộ thế hệ mới. Lỗi quota không thay thế dữ liệu đã xác nhận. Dữ liệu đã hỏng được báo lỗi, không coi là danh sách rỗng.

Hoàn thành được xác nhận trong cache trước. Nếu Drive lỗi, công việc được đánh dấu chờ lưu và có nút thử lại. Ghi chú chỉ được ẩn sau hai ngày khi đã lưu trữ; tin nhắn chỉ được gỡ khỏi giao diện sau khi Excel được lưu thành công. Trường hợp thử nghiệm Bùi Đức Thành không tạo tệp Drive.

Excel được xuất qua Drive `files.export`, kiểm tra phản hồi và định dạng ZIP/XLSX. Tệp cũ chỉ được chuyển vào thùng rác sau khi tạo thành công tệp mới; lịch sử không đọc được sẽ dừng thao tác thay vì bị bỏ qua.

## Tương thích và kiểm tra

Dữ liệu cũ được tiếp nhận khi dự án bắt đầu dùng cơ chế mới. Sau đó, các lệnh thay cả danh sách của bản cũ bị từ chối để bảo vệ dữ liệu mới. Phiên nhân viên cũ cần đăng nhập lại để nhận phiên xác thực công việc.

`npm test` chạy các kiểm thử dữ liệu, quyền, đồng bộ, cache và xuất tệp. `npm run test:ui` và `npm run test:workflow-ui` kiểm tra giao diện với dữ liệu mô phỏng, chặn toàn bộ kết nối Apps Script thật. Các lệnh build trực tiếp dùng cấu hình `vite.github.config.ts`.
