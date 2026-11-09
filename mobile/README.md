# GM Manager trên điện thoại

Bản Capacitor đóng gói giao diện GM Manager và dùng quyền của hệ điều hành. Trong ứng dụng, mở **Bật thông báo và vị trí** rồi chọn quyền muốn cấp. Phần vị trí cũng được xin khi sử dụng tính năng chụp ảnh thi công. Các thông báo hiện tại được tạo trên thiết bị từ dữ liệu app nhận được khi đang chạy. Thông báo đẩy khi ứng dụng đã đóng cần hệ thống gửi riêng.

Chạy các lệnh sau từ thư mục gốc của kho mã.

```sh
npm ci
npm ci --prefix mobile
npm exec vite -- build --config vite.mobile.config.ts
```

## Android

Cần JDK 21 và Android SDK 36. Chạy các lệnh sau để tạo APK cài thử.

```sh
npm run --prefix mobile sync:android
cd mobile/android
./gradlew assembleDebug
```

Trên Windows dùng `gradlew.bat assembleDebug`. APK nằm trong `app/build/outputs/apk/debug/`. Khi phát hành chính thức cần giữ ổn định khóa ký Android để các bản sau cập nhật được lên bản đã cài.

## iPhone

Trên macOS có Xcode, chạy lệnh đồng bộ rồi mở `mobile/ios/App/App.xcodeproj`.

```sh
npm run --prefix mobile sync:ios
```

Chọn Team trong **Signing & Capabilities** để chạy trên máy thật. CI tạo `GM-Manager-iPhone-unsigned.ipa` để ký lại trên máy của người cài. Apple Account miễn phí có thể dùng để cài thử cho máy cá nhân với Xcode Personal Team. Phân phối qua TestFlight cần Apple Developer Program.
