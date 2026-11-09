import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ResendEmailService {
  constructor(private readonly config: ConfigService) {}

  async sendVerificationEmail(email: string, fullName: string, token: string): Promise<void> {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    const from = this.config.get<string>('EMAIL_FROM');
    const appOrigin = this.config.getOrThrow<string>('APP_ORIGIN');

    if (!apiKey || !from) {
      throw new ServiceUnavailableException('Email delivery is not configured. Please try again later.');
    }

    const verificationUrl = new URL('/verify-email', appOrigin);
    verificationUrl.searchParams.set('token', token);

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: 'Verify your AssetPass email address',
        text: `Hello ${fullName},\n\nVerify your email address to activate your AssetPass account:\n${verificationUrl.toString()}\n\nThis link expires in 24 hours. If you did not create an AssetPass account, you can ignore this email.\n\nAssetPass`,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#123047"><h2>Verify your email address</h2><p>Hello ${escapeHtml(fullName)},</p><p>Confirm your email address to activate your AssetPass account.</p><p><a href="${verificationUrl.toString()}" style="display:inline-block;padding:12px 20px;background:#123047;color:#fff;text-decoration:none;border-radius:6px">Verify email address</a></p><p>This link expires in 24 hours. If you did not create an AssetPass account, you can ignore this email.</p><p>AssetPass</p></div>`,
      }),
    });

    if (!response.ok) {
      throw new ServiceUnavailableException('We could not send the verification email. Please request another verification email.');
    }
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] as string);
}
