import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformAuditLog } from './entities/platform-audit-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PlatformAuditLog])],
  exports: [TypeOrmModule],
})
export class AuditModule {}
