import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class HealthService {
  constructor(private readonly dataSource: DataSource) {}

  getLiveness() {
    return { status: 'ok', service: 'assetpass-api' };
  }

  async getReadiness() {
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'ready', dependencies: { database: 'available' } };
    } catch {
      throw new ServiceUnavailableException({
        status: 'not_ready',
        dependencies: { database: 'unavailable' },
      });
    }
  }
}
