# Chuyển GM Manager sang WebSocket

GitHub Pages tiếp tục phục vụ giao diện. Trình duyệt và ứng dụng PC kết nối tới máy chủ WebSocket qua `wss://`. Máy chủ phải xử lý các lệnh GM Manager, lưu dữ liệu dùng chung và gọi Google Drive bằng thông tin xác thực riêng. Chỉ đổi giao thức gửi yêu cầu sẽ không loại bỏ thời gian xử lý của Apps Script.

## Các luồng cần chuyển

| Luồng | Nguồn hiện tại | Yêu cầu khi chuyển |
| --- | --- | --- |
| Đăng nhập, nhân lực, quyền | Danh sách nhân lực, phiên đã ký và cấu hình trong Script Properties | Giữ định danh nhân viên, vai trò, quyền và mã đăng nhập có số 0 ở đầu. Kiểm tra phía máy chủ ở mỗi thao tác. Tạo khóa ký riêng và cấp lại phiên. |
| Khách hàng, ghi chú, thiết kế và tin nhắn | Dữ liệu workspace, dự án, trạng thái tin nhắn và dấu vết ghi/xóa trong Script Properties | Giữ khóa theo thư mục Drive gốc, năm, tháng và mã dự án. Giữ phiên bản, yêu cầu đã xử lý, hồ sơ đã xóa, dữ liệu chờ lưu trữ và đường dẫn chia sẻ đang dùng. |
| Tài liệu, 3D, ảnh và ghi âm | Thư mục, tệp và dữ liệu đi kèm trên Drive | Dùng Google Drive API với hỗ trợ Shared Drive. Giữ ID thư mục/tệp và đường dẫn mà ứng dụng PC dùng. Giữ ngày giờ Việt Nam và mã lần chụp khi gửi lại ảnh. |
| Xuất Excel và lưu trữ hoàn thành | Drive, Sheets và logic xuất trong Apps Script | Tạo và xác minh bản xuất trước khi thay tệp cũ. Ghi nhận trạng thái chờ lưu trữ nếu Drive chưa xác nhận. |
| Tích hợp khách hàng và âm thanh | Pancake, Gemini và cấu hình phía máy chủ | Cấp thông tin xác thực trên máy chủ. Kiểm tra luồng tin nhắn, phân quyền và xử lý âm thanh trước khi chuyển. |

## Cấu hình và giao thức

Đặt `VITE_GM_REALTIME_URL` thành URL `wss://` của máy chủ khi build giao diện. Chỉ môi trường cục bộ chấp nhận `ws://localhost`, `ws://127.0.0.1` hoặc `ws://[::1]`. Giữ URL không có tài khoản, mật khẩu, tham số hoặc fragment. Bản build có cấu hình WSS chỉ gửi lệnh qua WebSocket, kể cả sau khi kết nối bị lỗi. Bản build chưa có cấu hình sử dụng Apps Script.

Khi chuyển GitHub Pages, khai báo URL qua biến repository `GM_REALTIME_URL`. Workflow lấy biến này lúc build. Bản triển khai bật WebSocket cần endpoint đã thử với đủ lệnh trong bảng trên.

| Chiều | Khung JSON |
| --- | --- |
| Client → máy chủ | `{"type":"auth","token":"…"}`. Bỏ `token` nếu chưa đăng nhập. |
| Máy chủ → client | `{"type":"ready"}` sau khi chấp nhận phiên. Đóng bằng mã `4401` hoặc `4403` nếu phiên không được phép. |
| Client → máy chủ | `{"type":"request","id":"1","payload":{"action":"…"}}`. Giữ các trường của từng lệnh hiện tại trong `payload`. |
| Máy chủ → client | `{"type":"response","id":"1","status":200,"result":{"ok":true}}`. Lặp lại đúng `id` của yêu cầu. |
| Máy chủ → client | `{"type":"invalidate","resources":["workspace","personnel","assignments","messages","documents","photos"]}`. Chỉ gửi các loại tài nguyên vừa thay đổi cho phiên có quyền nhận. |
| Hai chiều | Client gửi `{"type":"ping"}`. Máy chủ trả `{"type":"pong"}`. |

Phiên chưa đăng nhập chỉ được thực hiện các thao tác công khai như đăng nhập và đọc dự án qua link chia sẻ hợp lệ. Máy chủ xác thực lại quyền của phiên và thao tác, rồi phát tín hiệu cập nhật sau khi ghi thành công. Khi kết nối lại, client xác thực lại và đọc trạng thái mới nhất. `id` của khung chỉ để ghép phản hồi trong một kết nối. Giữ mã thao tác gốc trong `payload` để máy chủ nhận biết yêu cầu đã xử lý sau khi kết nối bị gián đoạn.

## Triển khai trên ChatGPT Sites

ChatGPT Sites hỗ trợ WebSocket, cơ sở dữ liệu D1 và kho tệp R2. Đây là một lựa chọn để chạy máy chủ. Connector hiện chưa tìm thấy dự án Sites theo ID trong `.openai/hosting.json` của workspace này. Cần một dự án truy cập được để thử bản triển khai. [Tài liệu ChatGPT Sites](https://learn.chatgpt.com/docs/sites#understand-limits-and-unsupported-uses).

Nếu dùng Sites cho cả giao diện và máy chủ, kiểm tra đăng nhập và handshake cùng nguồn với đúng quyền truy cập của Site. Nếu giữ GitHub Pages và ứng dụng PC, kiểm tra handshake từ nguồn GitHub Pages và quyền truy cập của từng nhóm người dùng. Quyền vào Site và quyền thao tác GM Manager cần được kiểm tra riêng.

Kiểm tra tín hiệu tới hai kết nối do các phiên bản Worker khác nhau xử lý. Lưu thay đổi đã xác nhận và số thứ tự sự kiện trong D1 để có thể đọc bù sau khi kết nối lại. Cần xác minh cách chuyển tín hiệu giữa các kết nối đang mở, chẳng hạn Durable Objects nếu dự án cung cấp binding đó hoặc một dịch vụ điều phối riêng. D1 có thể lưu lịch sử để đọc bù, còn việc gửi tín hiệu trực tiếp giữa các phiên Worker cần một cơ chế chuyển tiếp đã được kiểm thử.

## Chuẩn bị máy chủ và dữ liệu

- Có địa chỉ WSS ổn định, kho dữ liệu lâu bền và quyền triển khai. Cloudflare Workers với Durable Objects phù hợp để duy trì kết nối và điều phối cập nhật. Máy chủ Node với cơ sở dữ liệu dùng chung cũng đáp ứng được giao thức.
- Cấp cho danh tính của máy chủ đúng quyền trên Shared Drive dự án. Cấu hình khóa ký phiên, token tích hợp và giới hạn nguồn truy cập từ GitHub Pages. Lưu các giá trị này trong kho bí mật của máy chủ.
- Tạo bản xuất một lần từ trình chỉnh sửa Apps Script dưới tài khoản chủ sở hữu. Hàm xuất kiểm tra danh sách khóa được phép, đọc mỗi giá trị bằng `readPropertyJson_` để lấy đúng bản đã ghi xong và giữ dấu xóa. Lưu bản xuất vào nơi chỉ nhóm chuyển dữ liệu truy cập. Không thêm lệnh xuất vào `doPost`, không ghi nội dung xuất trong log và không đưa bản xuất lên Git.
- Kiểm kê `gmcrm-workspace-cache-v1`, `gmcrm-personnel-state-v1`, các dự án `gmcrm-workflow-project-v2-*`, chỉ mục và tác vụ thiết kế, trạng thái và nguồn tin nhắn, dấu xóa/đổi tên khách hàng, ghi chú cũ và con trỏ/sự kiện ảnh. Đối chiếu bằng số lượng, khóa bản ghi và ID Drive. Cấu hình bí mật ở nơi triển khai bằng kênh riêng.

## Kiểm tra và chuyển lưu lượng

1. Nhập bản xuất vào môi trường kiểm thử. So sánh các lượt đọc với hệ thống hiện tại. Dùng bản sao Drive để chạy ghi thử cho đăng nhập, quyền theo vai trò, tạo/đổi tên/xóa hồ sơ, giao việc, lưu ảnh, phục hồi khi gửi lại và xuất Excel. Thử hai thiết bị, ngắt mạng, kết nối lại và đổi tài khoản.
2. Kiểm tra hàng đợi trên máy khách. `app/workflow-client.ts` dùng cả tài khoản và URL máy chủ để nhận diện lệnh chờ. Hồ sơ đang chờ tạo thư mục còn có `pendingDriveSyncScope` chứa URL cũ và ID thư mục Drive gốc. Hoàn tất các hàng đợi trước khi chuyển hoặc xác minh từng bản ghi, cập nhật đúng phạm vi máy chủ mới và giữ nguyên mã yêu cầu, mã dự án và thư mục Drive.
3. Trong đợt chuyển, tạm dừng ghi vào hệ thống cũ, lấy bản xuất cuối và đối chiếu lại. Chỉ trỏ bản đang dùng sang WSS sau khi xác minh dữ liệu, quyền và thao tác Drive. Sau khi bật WSS, chạy thử với hai phiên thật và kiểm tra một thay đổi đến thiết bị còn lại ngay sau khi máy chủ xác nhận.
4. Giữ bản sao trước khi chuyển và nhật ký ghi trên máy chủ mới. Nếu cần quay lại, tạm dừng ghi mới và đồng bộ các thay đổi đã xác nhận về hệ thống cũ trước khi mở lại. Hai máy chủ ghi đồng thời có thể tạo dữ liệu khác nhau.

Việc chuyển hoàn toàn phụ thuộc vào máy chủ đã triển khai, quyền Drive và bản xuất đã kiểm tra. Cấu hình WSS trên giao diện chưa chứng minh những phần đó đã sẵn sàng.
