import nodemailer from 'nodemailer';

type CredentialEmailContext = {
  recipientName: string;
  email: string;
  customId: string;
  temporaryPassword: string;
  portalLabel: string;
  introMessage: string;
};

const smtpHost = process.env.SMTP_HOST ?? '';
const smtpPort = Number.parseInt(process.env.SMTP_PORT ?? '587', 10);

const transporter = nodemailer.createTransport({
  host: smtpHost || 'smtp.example.com',
  port: Number.isFinite(smtpPort) ? smtpPort : 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: smtpHost
    ? {
        user: process.env.SMTP_USER ?? 'admin@example.com',
        pass: process.env.SMTP_PASS ?? 'password',
      }
    : undefined,
});

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildCredentialEmailHtml(context: CredentialEmailContext): string {
  const safeName = escapeHtml(context.recipientName || 'User');
  const safeEmail = escapeHtml(context.email);
  const safeCustomId = escapeHtml(context.customId);
  const safePassword = escapeHtml(context.temporaryPassword);
  const safePortalLabel = escapeHtml(context.portalLabel);
  const safeIntroMessage = escapeHtml(context.introMessage);

  return `
    <div style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
      <div style="max-width:680px;margin:0 auto;padding:32px 20px;">
        <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,0.08);">
          <div style="padding:28px 32px;background:linear-gradient(135deg,#0f172a 0%,#1d4ed8 100%);color:#ffffff;">
            <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.85;">Institutional Account Provisioning</p>
            <h1 style="margin:0;font-size:28px;line-height:1.2;">Welcome, ${safeName}</h1>
          </div>
          <div style="padding:32px;">
            <p style="margin:0 0 18px;font-size:16px;line-height:1.7;">${safeIntroMessage}</p>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:20px 22px;margin:24px 0;">
              <table style="width:100%;border-collapse:collapse;font-size:15px;line-height:1.7;">
                <tr>
                  <td style="padding:6px 0;color:#475569;width:38%;">Login Email</td>
                  <td style="padding:6px 0;font-weight:700;color:#0f172a;">${safeEmail}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:#475569;">${safePortalLabel} ID</td>
                  <td style="padding:6px 0;font-weight:700;color:#0f172a;">${safeCustomId}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:#475569;">Temporary Password</td>
                  <td style="padding:6px 0;font-weight:700;color:#0f172a;">${safePassword}</td>
                </tr>
              </table>
            </div>
            <p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:#475569;">
              You can sign in to the portal using the credentials above. The system will require you to change the password after the first login.
            </p>
            <p style="margin:0;font-size:13px;line-height:1.7;color:#64748b;">
              This message was generated automatically for account provisioning.
            </p>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function sendCredentialEmail(context: CredentialEmailContext): Promise<void> {
  const fromAddress = process.env.MAIL_FROM ?? '"School Admin" <admin@school.com>';

  await transporter.sendMail({
    from: fromAddress,
    to: context.email,
    subject: `Your ${context.portalLabel} Account Details`,
    html: buildCredentialEmailHtml(context),
  });
}

export async function sendWelcomeStudentEmail(to: string, name: string, customId: string, tempPassword: string): Promise<void> {
  await sendCredentialEmail({
    recipientName: name,
    email: to,
    customId,
    temporaryPassword: tempPassword,
    portalLabel: 'Student',
    introMessage: 'Your student account has been created successfully and is now ready for first login.',
  });
}

export async function sendWelcomeParentEmail(to: string, name: string, customId: string, tempPassword: string): Promise<void> {
  await sendCredentialEmail({
    recipientName: name,
    email: to,
    customId,
    temporaryPassword: tempPassword,
    portalLabel: 'Parent',
    introMessage: "Your parent account has been created successfully and linked to your child's profile.",
  });
}

export async function sendExistingParentNewChildEmail(to: string, parentName: string, studentName: string, studentId: string): Promise<void> {
  const html = `
    <div style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
      <div style="max-width:680px;margin:0 auto;padding:32px 20px;">
        <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,0.08);">
          <div style="padding:28px 32px;background:linear-gradient(135deg,#0f172a 0%,#0f766e 100%);color:#ffffff;">
            <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.85;">Child Link Notification</p>
            <h1 style="margin:0;font-size:28px;line-height:1.2;">Hello, ${escapeHtml(parentName || 'Parent')}</h1>
          </div>
          <div style="padding:32px;">
            <p style="margin:0 0 18px;font-size:16px;line-height:1.7;">
              A new student account for <strong>${escapeHtml(studentName)}</strong> has been linked to your existing parent profile.
            </p>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:20px 22px;margin:24px 0;">
              <table style="width:100%;border-collapse:collapse;font-size:15px;line-height:1.7;">
                <tr>
                  <td style="padding:6px 0;color:#475569;width:38%;">Student Name</td>
                  <td style="padding:6px 0;font-weight:700;color:#0f172a;">${escapeHtml(studentName)}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:#475569;">Student ID</td>
                  <td style="padding:6px 0;font-weight:700;color:#0f172a;">${escapeHtml(studentId)}</td>
                </tr>
              </table>
            </div>
            <p style="margin:0;font-size:14px;line-height:1.7;color:#64748b;">
              No password was changed for your existing account. You can now review the new child from your parent dashboard.
            </p>
          </div>
        </div>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: process.env.MAIL_FROM ?? '"School Admin" <admin@school.com>',
    to,
    subject: 'New Student Linked to Your Parent Account',
    html,
  });
}

export async function sendWelcomeTeacherEmail(to: string, name: string, customId: string, tempPassword: string): Promise<void> {
  await sendCredentialEmail({
    recipientName: name,
    email: to,
    customId,
    temporaryPassword: tempPassword,
    portalLabel: 'Teacher',
    introMessage: 'Your teacher account has been created successfully and is ready for first login.',
  });
}
