import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { PlatformAuditLog } from '../audit/entities/platform-audit-log.entity';
import { Organization } from './entities/organization.entity';
import { OrganizationMembership } from './entities/organization-membership.entity';
import { OrganizationsController } from './organizations.controller';
import { PlatformOrganizationsController } from './platform-organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  imports: [TypeOrmModule.forFeature([Organization, OrganizationMembership, PlatformAuditLog]), AuthModule, AccessControlModule],
  controllers: [OrganizationsController, PlatformOrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
