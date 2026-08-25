# Tự động cập nhật Google Apps Script

Mã nguồn chính của Google Apps Script nằm tại `apps-script/Code.js`. Khi thay
đổi thư mục `apps-script/` được đưa lên nhánh `main`, workflow
`Deploy Google Apps Script` sẽ:

1. Đẩy toàn bộ mã nguồn mới vào Apps Script project.
2. Tạo một version mới.
3. Cập nhật đúng Web App deployment hiện tại nên URL `/exec` không đổi.

## Cấu hình một lần

1. Bật **Google Apps Script API** tại
   <https://script.google.com/home/usersettings>.
2. Trên máy cá nhân, đăng nhập tài khoản Google đang sở hữu GM-Manager:

   ```powershell
   npx --yes @google/clasp@3.3.0 login
   ```

3. Trong Apps Script, mở **Project Settings** và sao chép **Script ID**.
4. Trong GitHub repository, mở **Settings → Secrets and variables → Actions** và
   tạo hai repository secrets:

   - `APPS_SCRIPT_ID`: Script ID ở bước 3.
   - `CLASPRC_JSON`: toàn bộ nội dung file
     `%USERPROFILE%\.clasprc.json` được tạo ở bước 2.

5. Mở tab **Actions**, chọn **Deploy Google Apps Script**, rồi chạy
   **Run workflow** lần đầu để kiểm tra.

`CLASPRC_JSON` chứa quyền đăng nhập Google. Không đưa file này vào repository,
không gửi qua tin nhắn và chỉ lưu trong GitHub Actions secret.

Deployment ID hiện tại đã được cấu hình trong workflow từ Web App URL mà
GM-CRM đang dùng. Nếu tạo một deployment hoàn toàn mới, cần thay ID đó trong
`.github/workflows/deploy-apps-script.yml`.

## Quy tắc sửa mã từ nay

- Chỉ sửa `apps-script/Code.js`.
- Không sửa trực tiếp bản sao `public/gm-crm-drive-script.js`.
- Lệnh build/dev tự đồng bộ bản sao public để nút xem mã trong GM-CRM luôn hiển
  thị đúng phiên bản.
