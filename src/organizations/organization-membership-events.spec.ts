import { appendOrganizationMembershipEvent } from './organization-membership-events';
import { OrganizationMembershipEventType } from './entities/organization-membership-event.entity';
import { OrganizationMembershipStatus } from './entities/organization-membership.entity';

describe('appendOrganizationMembershipEvent', () => {
  it('creates an ordered event through the transaction manager without accepting a caller-supplied sequence', async () => {
    const savedEvent = { id: 'event-id', eventSequence: '42' };
    const repository = {
      create: jest.fn((input) => input),
      save: jest.fn().mockResolvedValue(savedEvent),
    };
    const manager = {
      getRepository: jest.fn().mockReturnValue(repository),
    };

    const effectiveAt = new Date('2026-11-28T01:00:00.000Z');
    const result = await appendOrganizationMembershipEvent(manager as never, {
      membershipId: 'membership-id',
      eventType: OrganizationMembershipEventType.MEMBERSHIP_REMOVED,
      previousStatus: OrganizationMembershipStatus.ACTIVE,
      newStatus: OrganizationMembershipStatus.REMOVED,
      actorUserId: 'actor-id',
      effectiveAt,
      reason: 'Membership ended by an authorized administrator.',
      metadata: { source: 'member_management' },
    });

    expect(repository.create).toHaveBeenCalledWith({
      membershipId: 'membership-id',
      eventType: OrganizationMembershipEventType.MEMBERSHIP_REMOVED,
      previousStatus: OrganizationMembershipStatus.ACTIVE,
      newStatus: OrganizationMembershipStatus.REMOVED,
      actorUserId: 'actor-id',
      effectiveAt,
      reason: 'Membership ended by an authorized administrator.',
      metadata: { source: 'member_management' },
    });
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(result).toBe(savedEvent);
  });
});
