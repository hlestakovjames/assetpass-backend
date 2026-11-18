import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrganizationOnboardingSession } from '../entities/organization-onboarding-session.entity';

@Injectable()
export class OrganizationOnboardingSessionGuard implements CanActivate {
  constructor(
    @InjectRepository(OrganizationOnboardingSession)
    private readonly sessions: Repository<OrganizationOnboardingSession>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = request.headers['x-organization-onboarding-session'];
    if (typeof token !== 'string' || token.length < 32 || token.length > 200) {
      throw new UnauthorizedException('A valid organisation onboarding session is required.');
    }
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const now = new Date();
    const session = await this.sessions.createQueryBuilder('session')
      .addSelect('session.tokenHash')
      .where('session.tokenHash = :tokenHash', { tokenHash })
      .andWhere('session.revokedAt IS NULL')
      .andWhere('session.expiresAt > :now', { now })
      .andWhere('session.lastSeenAt > :idleCutoff', { idleCutoff: new Date(now.getTime() - 30 * 60 * 1000) })
      .getOne();
    if (!session) throw new UnauthorizedException('This organisation onboarding session has expired or been closed.');
    await this.sessions.update({ id: session.id, revokedAt: null }, { lastSeenAt: now });
    request.organizationOnboarding = {
      sessionId: session.id,
      applicationId: session.applicationId,
      scopes: session.scopes,
    };
    return true;
  }
}
