import { ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;
  let dataSource: { query: jest.Mock };

  beforeEach(() => {
    dataSource = { query: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    service = new HealthService(dataSource as unknown as DataSource);
  });

  it('reports liveness without querying the database', () => {
    expect(service.getLiveness()).toEqual({
      status: 'ok',
      service: 'assetpass-api',
    });
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('reports readiness when PostgreSQL responds', async () => {
    await expect(service.getReadiness()).resolves.toEqual({
      status: 'ready',
      dependencies: { database: 'available' },
    });
    expect(dataSource.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('returns a sanitized unavailable response when PostgreSQL fails', async () => {
    dataSource.query.mockRejectedValue(new Error('private connection details'));
    await expect(service.getReadiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
