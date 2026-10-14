# Nhà Yến Zalo v2.5.60

## Khắc phục Quét nhóm Zalo, nút Chèn báo giá và Rời nhóm

**Triệu chứng**

- Quét nhóm báo “Không tương thích” hoặc “Zalo Web chưa cung cấp groupManager”, đọc 0 nhóm / 0 ID, hoặc bị kẹt ở “Đang tìm nhóm”.
- Nút **Chèn vào ô soạn tin** ở tab Báo giá: chữ hiện đè lên nhau, các dòng dính liền, bấm Enter không gửi được.
- Rời nhóm hàng loạt báo “Zalo Web chưa cung cấp groupManager”.

**Nguyên nhân**

- Zalo Web đổi tên biến nội bộ, còn bộ quét nhóm và bộ rời nhóm vẫn chỉ gọi đúng `window.groupManager` nên chết ngay khi tên biến khác.
- Nội dung báo giá đi qua đường dán của tin nhắn nhanh, mà đường đó chỉ cho dán nội dung đúng bằng một mẫu tin nhắn nhanh đã lưu. Báo giá do app dựng nên bị chặn, rơi về nhánh dựng chữ bằng DOM — chỉ hiện được trên màn hình, trạng thái gửi vẫn rỗng nên Enter không gửi được.

**Cách sửa**

- **Quét nhóm** viết lại theo đúng công nghệ đang chạy tốt của Quét người dùng: thử nhiều tên manager, bọc `fetch` / `XMLHttpRequest` / `JSON.parse` để đọc dữ liệu Zalo tự tải về, lọc theo hình dạng nhóm, tự mở tab Nhóm và kéo danh sách. Không còn phụ thuộc một tên biến của Zalo.
- **Chèn báo giá** có kênh riêng, gõ thật từng dòng bằng input tin cậy của Chromium (xuống dòng bằng Shift+Enter) nên giữ đúng xuống dòng và Enter gửi được.
- **Rời nhóm** thử nhiều tên manager và không chặn nếu không tìm thấy manager, vì bước rời thật chỉ cần API đã xác minh `/api/group/leave`.
- Thêm giới hạn chờ cho các lệnh Zalo treo để không bị kẹt vô hạn ở “Đang lấy chi tiết”.