import { DataSource, IsNull } from 'typeorm';

import { PlatformAuditLog } from '../audit/entities/platform-audit-log.entity';
import { User, UserStatus } from '../identity/entities/user.entity';
import { PlatformGovernanceState } from './entities/platform-governance-state.entity';
import { PlatformRole, PlatformRoleName } from './entities/platform-role.entity';

export interface InitialPlatformOwnerInput {
  fullName: string;
  email: string;
  passwordHash: string;
}

export async function completePlatformOwnerBootstrap(
  dataSource: DataSource,
  input: InitialPlatformOwnerInput,
): Promise<User> {
  return dataSource.transaction(async (manager) => {
    const states = (await manager.query(
      `SELECT id, bootstrap_completed_at, initial_owner_user_id
       FROM platform_governance_state
       WHERE id = 1
       FOR UPDATE`,
    )) as Array<{
      id: number;
      bootstrap_completed_at: Date | null;
      initial_owner_user_id: string | null;
    }>;

    if (states.length !== 1) {
      throw new Error('Platform governance state is missing or invalid.');
    }

    const state = states[0];

    if (
      state.bootstrap_completed_at !== null ||
      state.initial_owner_user_id !== null
    ) {
      throw new Error('Platform bootstrap has already been completed.');
    }

    const roleRepository = manager.getRepository(PlatformRole);

    const existingOwner = await roleRepository.findOne({
      where: {
        role: PlatformRoleName.OWNER,
        revokedAt: IsNull(),
      },
    });

    if (existingOwner) {
      throw new Error('An active Platform Owner already exists.');
    }

    const userRepository = manager.getRepository(User);

    const existingUser = await userRepository.findOne({
      where: { email: input.email },
    });

    if (existingUser) {
      throw new Error('A user with this email already exists.');
    }

    const owner = userRepository.create({
      fullName: input.fullName,
      email: input.email,
      passwordHash: input.passwordHash,
      status: UserStatus.ACTIVE,
      isFoundingAssetManager: false,
      lastLoginAt: null,
      deactivatedAt: null,
    });

    const savedOwner = await userRepository.save(owner);

    await roleRepository.save(
      roleRepository.create({
        userId: savedOwner.id,
        role: PlatformRoleName.OWNER,
        assignedByUserId: null,
        revokedAt: null,
        reason: 'Initial Platform Owner established during secure bootstrap.',
      }),
    );

    const updateResult = await manager
      .getRepository(PlatformGovernanceState)
      .update(
        {
          id: 1,
          bootstrapCompletedAt: IsNull(),
          initialOwnerUserId: IsNull(),
        },
        {
          bootstrapCompletedAt: new Date(),
          initialOwnerUserId: savedOwner.id,
        },
      );

    if (updateResult.affected !== 1) {
      throw new Error('Bootstrap state update failed. Transaction aborted.');
    }

    const auditRepository = manager.getRepository(PlatformAuditLog);

    await auditRepository.save(
      auditRepository.create({
        actorUserId: savedOwner.id,
        action: 'platform.bootstrap.completed',
        entityType: 'platform_governance',
        entityId: savedOwner.id,
        outcome: 'success',
        reason: 'Initial Platform Owner established.',
        metadata: {
          bootstrapMethod: 'one_time_cli',
          assignedRole: PlatformRoleName.OWNER,
        },
      }),
    );

    return savedOwner;
  });
}
