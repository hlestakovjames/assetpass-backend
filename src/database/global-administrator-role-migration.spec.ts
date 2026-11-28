import { QueryRunner } from 'typeorm';
import { MapLegacyPlatformRolesToGlobalAdministrator1794900000000 } from './migrations/1794900000000-MapLegacyPlatformRolesToGlobalAdministrator';

describe('MapLegacyPlatformRolesToGlobalAdministrator1794900000000', () => {
  let migration: MapLegacyPlatformRolesToGlobalAdministrator1794900000000;
  let query: jest.Mock;

  beforeEach(() => {
    migration = new MapLegacyPlatformRolesToGlobalAdministrator1794900000000();
    query = jest.fn().mockResolvedValue([{ count: 0 }]);
  });

  it('maps both legacy roles in place and recreates the top-administrator uniqueness constraint', async () => {
    await migration.up({ query } as unknown as QueryRunner);

    expect(query).toHaveBeenCalledTimes(6);
    expect(query.mock.calls[0][0]).toContain("'Global Administrator'");
    expect(query.mock.calls[1][0]).toContain('DROP INDEX');
    expect(query.mock.calls[2][0]).toContain('DROP CONSTRAINT');
    expect(query.mock.calls[3][0]).toContain("WHEN 'Platform Owner' THEN 'Global Administrator'");
    expect(query.mock.calls[3][0]).toContain("WHEN 'Platform Administrator' THEN 'Central Platform Administrator'");
    expect(query.mock.calls[5][0]).toContain("WHERE \"role\" = 'Global Administrator'");
  });

  it('refuses to apply when target role names already exist', async () => {
    query.mockResolvedValueOnce([{ count: 1 }]);

    await expect(
      migration.up({ query } as unknown as QueryRunner),
    ).rejects.toThrow('found target role rows before conversion');

    expect(query).toHaveBeenCalledTimes(1);
  });

  it('reverses role labels without changing role record identities or grant references', async () => {
    await migration.down({ query } as unknown as QueryRunner);

    expect(query).toHaveBeenCalledTimes(6);
    expect(query.mock.calls[3][0]).toContain("WHEN 'Global Administrator' THEN 'Platform Owner'");
    expect(query.mock.calls[3][0]).toContain("WHEN 'Central Platform Administrator' THEN 'Platform Administrator'");
    expect(query.mock.calls[5][0]).toContain("WHERE \"role\" = 'Platform Owner'");
  });

  it('refuses rollback if legacy role names already coexist', async () => {
    query.mockResolvedValueOnce([{ count: 1 }]);

    await expect(
      migration.down({ query } as unknown as QueryRunner),
    ).rejects.toThrow('Cannot roll back platform role naming');

    expect(query).toHaveBeenCalledTimes(1);
  });
});
