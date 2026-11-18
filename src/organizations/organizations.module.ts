import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { OrganizationMembershipRole } from '../access-control/entities/organization-membership-role.entity';
import { OrganizationRole } from '../access-control/entities/organization-role.entity';
import { OrganizationRolePermission } from '../access-control/entities/organization-role-permission.entity';
import { Permission } from '../access-control/entities/permission.entity';
import { PlatformAuditLog } from '../audit/entities/platform-audit-log.entity';
import { User } from '../identity/entities/user.entity';
import { Organization } from './entities/organization.entity';
import { OrganizationMembership } from './entities/organization-membership.entity';
import { OrganizationOnboardingApplication } from './entities/organization-onboarding-application.entity';
import { OrganizationOnboardingSession } from './entities/organization-onboarding-session.entity';
import { OrganizationOnboardingSessionGuard } from './guards/organization-onboarding-session.guard';
import { OrganizationOnboardingController } from './organization-onboarding.controller';
import { OrganizationOnboardingService } from './organization-onboarding.service';
import { OrganizationsController } from './organizations.controller';
import { PlatformOrganizationsController } from './platform-organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Organization, OrganizationMembership, OrganizationOnboardingApplication, OrganizationOnboardingSession, OrganizationRole, OrganizationMembershipRole,
      OrganizationRolePermission, Permission, User, PlatformAuditLog,
    ]),
    AuthModule,
    AccessControlModule,
  ],
  controllers: [OrganizationsController, PlatformOrganizationsController, OrganizationOnboardingController],
  providers: [OrganizationsService, OrganizationOnboardingService, OrganizationOnboardingSessionGuard],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
