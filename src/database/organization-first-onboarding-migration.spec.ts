import { QueryRunner } from 'typeorm';
import { CreateOrganizationFirstOnboarding1794700000000 } from './migrations/1794700000000-CreateOrganizationFirstOnboarding';

describe('CreateOrganizationFirstOnboarding1794700000000', () => {
  let migration: CreateOrganizationFirstOnboarding1794700000000;

  beforeEach(() => {
    migration = new CreateOrganizationFirstOnboarding1794700000000();
  });

  it('refuses rollback while onboarding application records exist', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ count: '1' }]);
    const queryRunner = { query } as unknown as QueryRunner;

    await expect(migration.down(queryRunner)).rejects.toThrow(
      'Cannot revert CreateOrganizationFirstOnboarding while onboarding applications exist.',
    );

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('organization_onboarding_applications');
  });

  it('refuses rollback while organisations have no linked creator', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([{ count: '2' }]);
    const queryRunner = { query } as unknown as QueryRunner;

    await expect(migration.down(queryRunner)).rejects.toThrow(
      'Cannot revert CreateOrganizationFirstOnboarding while organizations have no creator.',
    );

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('DROP TABLE'))).toBe(false);
  });

  it('drops the empty onboarding table and restores the creator constraint when safe', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValue([]);
    const queryRunner = { query } as unknown as QueryRunner;

    await migration.down(queryRunner);

    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls[2][0]).toBe(
      'DROP TABLE "organization_onboarding_applications"',
    );
    expect(query.mock.calls[3][0]).toBe(
      'ALTER TABLE "organizations" ALTER COLUMN "created_by_user_id" SET NOT NULL',
    );
  });
});
