import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { PlatformAuditLog } from '../audit/entities/platform-audit-log.entity';
import { IndividualWorkspace } from './entities/individual-workspace.entity';
import { IndividualWorkspaceController } from './individual-workspace.controller';
import { IndividualWorkspaceService } from './individual-workspace.service';

@Module({
  imports: [TypeOrmModule.forFeature([IndividualWorkspace, PlatformAuditLog]), AuthModule],
  controllers: [IndividualWorkspaceController],
  providers: [IndividualWorkspaceService],
  exports: [IndividualWorkspaceService],
})
export class WorkspacesModule {}
