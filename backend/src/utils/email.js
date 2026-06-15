const nodemailer = require('nodemailer');

// The transporter is configured using SMTP settings.
// Gmail is used as the default service, but you can change it via ENV vars.
const createTransporter = () => {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SMTP_USER, // e.g., your.email@gmail.com
      pass: process.env.SMTP_PASS, // App Password from Google Account
    },
  });
};

/**
 * Send an email with the verification code.
 * @param {string} toEmail 
 * @param {string} code 
 */
async function sendPasswordResetEmail(toEmail, code) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('SMTP_USER or SMTP_PASS not set in .env! Email not sent.');
    console.log(`[DEV MODE] Forgot Password Code for ${toEmail}: ${code}`);
    return;
  }

  const transporter = createTransporter();

  const mailOptions = {
    from: `"9Meta Admin" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: 'Mã xác nhận khôi phục mật khẩu 9Meta',
    html: `
      <div style="font-family: sans-serif; max-w: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: #333; text-align: center;">Khôi phục mật khẩu</h2>
        <p>Chào bạn,</p>
        <p>Bạn đã yêu cầu đặt lại mật khẩu cho tài khoản <strong>${toEmail}</strong> trên hệ thống 9Meta.</p>
        <p>Mã xác nhận của bạn là:</p>
        <div style="text-align: center; margin: 30px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #6366f1; background: #f3f4f6; padding: 10px 20px; border-radius: 8px;">
            ${code}
          </span>
        </div>
        <p style="color: #666; font-size: 14px;">Mã này sẽ hết hạn sau 15 phút. Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="color: #999; font-size: 12px; text-align: center;">© 9Meta. All rights reserved.</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
}

module.exports = {
  sendPasswordResetEmail,
};
