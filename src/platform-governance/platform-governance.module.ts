import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformGovernanceState } from './entities/platform-governance-state.entity';
import { PlatformOwnerSuccession } from './entities/platform-owner-succession.entity';
import { PlatformRole } from './entities/platform-role.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PlatformGovernanceState,
      PlatformOwnerSuccession,
      PlatformRole,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class PlatformGovernanceModule {}
