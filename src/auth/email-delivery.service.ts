import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EmailDeliveryService {
  constructor(private readonly config: ConfigService) {}

  async sendVerificationEmail(email: string, fullName: string, token: string): Promise<void> {
    const provider = (this.config.get<string>('EMAIL_PROVIDER') ?? 'brevo').toLowerCase();
    const appOrigin = this.config.getOrThrow<string>('APP_ORIGIN');
    const verificationUrl = new URL('/verify-email', appOrigin);
    verificationUrl.searchParams.set('token', token);

    const textContent = `Hello ${fullName},\n\nVerify your email address to activate your AssetPass account:\n${verificationUrl.toString()}\n\nThis link expires in 24 hours. If you did not create an AssetPass account, you can ignore this email.\n\nAssetPass`;
    const htmlContent = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#123047"><h2>Verify your email address</h2><p>Hello ${escapeHtml(fullName)},</p><p>Confirm your email address to activate your AssetPass account.</p><p><a href="${verificationUrl.toString()}" style="display:inline-block;padding:12px 20px;background:#123047;color:#fff;text-decoration:none;border-radius:6px">Verify email address</a></p><p>This link expires in 24 hours. If you did not create an AssetPass account, you can ignore this email.</p><p>AssetPass</p></div>`;

    if (provider === 'brevo') {
      const apiKey = this.config.get<string>('BREVO_API_KEY');
      const senderEmail = this.config.get<string>('BREVO_SENDER_EMAIL');
      const senderName = this.config.get<string>('BREVO_SENDER_NAME') ?? 'AssetPass';
      if (!apiKey || !senderEmail) {
        throw new ServiceUnavailableException('Email delivery is not configured. Please try again later.');
      }

      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { name: senderName, email: senderEmail },
          to: [{ email }],
          subject: 'Verify your AssetPass email address',
          textContent,
          htmlContent,
        }),
      });
      if (!response.ok) {
        throw new ServiceUnavailableException('We could not send the verification email. Please request another verification email.');
      }
      return;
    }

    if (provider === 'resend') {
      const apiKey = this.config.get<string>('RESEND_API_KEY');
      const from = this.config.get<string>('EMAIL_FROM');
      if (!apiKey || !from) {
        throw new ServiceUnavailableException('Email delivery is not configured. Please try again later.');
      }
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [email], subject: 'Verify your AssetPass email address', text: textContent, html: htmlContent }),
      });
      if (!response.ok) {
        throw new ServiceUnavailableException('We could not send the verification email. Please request another verification email.');
      }
      return;
    }

    throw new ServiceUnavailableException('The configured email provider is not supported.');
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] as string);
}
