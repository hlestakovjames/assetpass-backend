import { EntityManager } from 'typeorm';
import { OrganizationMembershipStatus } from './entities/organization-membership.entity';
import {
  OrganizationMembershipEvent,
  OrganizationMembershipEventType,
} from './entities/organization-membership-event.entity';

export interface AppendOrganizationMembershipEventInput {
  membershipId: string;
  eventType: OrganizationMembershipEventType;
  previousStatus: OrganizationMembershipStatus | null;
  newStatus: OrganizationMembershipStatus | null;
  actorUserId: string | null;
  effectiveAt?: Date;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function appendOrganizationMembershipEvent(
  manager: EntityManager,
  input: AppendOrganizationMembershipEventInput,
): Promise<OrganizationMembershipEvent> {
  const repository = manager.getRepository(OrganizationMembershipEvent);
  return repository.save(
    repository.create({
      membershipId: input.membershipId,
      eventType: input.eventType,
      previousStatus: input.previousStatus,
      newStatus: input.newStatus,
      actorUserId: input.actorUserId,
      effectiveAt: input.effectiveAt ?? new Date(),
      reason: input.reason ?? null,
      metadata: input.metadata ?? null,
    }),
  );
}
