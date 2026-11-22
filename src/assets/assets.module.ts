import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { PlatformAuditLog } from '../audit/entities/platform-audit-log.entity';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationMembership } from '../organizations/entities/organization-membership.entity';
import { AssetParty } from './entities/asset-party.entity';
import { ExternalAssetParty } from './entities/external-asset-party.entity';
import { AssetRegistrationApplication } from './entities/asset-registration-application.entity';
import { AssetRegistrationEvidence } from './entities/asset-registration-evidence.entity';
import { AssetEvidenceUpload } from './entities/asset-evidence-upload.entity';
import { Asset } from './entities/asset.entity';
import { AssetOwnership } from './entities/asset-ownership.entity';
import { AssetRegistrationRecord } from './entities/asset-registration-record.entity';
import { AssetsController } from './assets.controller';
import { OrganizationAssetsController } from './organization-assets.controller';
import { AssetsService } from './assets.service';
import { EvidenceStorageService } from './evidence-storage.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AssetParty, ExternalAssetParty, AssetRegistrationApplication, AssetRegistrationEvidence, AssetEvidenceUpload,
      Asset, AssetOwnership, AssetRegistrationRecord, Organization,
      OrganizationMembership, PlatformAuditLog,
    ]),
    AuthModule,
    AccessControlModule,
  ],
  controllers: [AssetsController, OrganizationAssetsController],
  providers: [AssetsService, EvidenceStorageService],
  exports: [AssetsService],
})
export class AssetsModule {}
