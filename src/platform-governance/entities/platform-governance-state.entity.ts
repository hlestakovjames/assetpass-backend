import {
  Column,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('platform_governance_state')
export class PlatformGovernanceState {
  @PrimaryColumn({ type: 'smallint', default: 1 })
  id: number;

  @Column({
    name: 'bootstrap_completed_at',
    type: 'timestamptz',
    nullable: true,
  })
  bootstrapCompletedAt: Date | null;

  @Column({
    name: 'initial_owner_user_id',
    type: 'uuid',
    nullable: true,
  })
  initialOwnerUserId: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
