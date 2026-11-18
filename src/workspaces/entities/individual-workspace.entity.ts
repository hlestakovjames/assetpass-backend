import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum IndividualWorkspaceStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Entity('individual_workspaces')
@Index('uq_individual_workspaces_user', ['userId'], { unique: true })
@Check(
  'CHK_individual_workspace_lifecycle',
  `("status" = 'active' AND "activated_at" IS NOT NULL AND "deactivated_at" IS NULL)
   OR ("status" = 'inactive' AND "deactivated_at" IS NOT NULL)`,
)
export class IndividualWorkspace {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({
    type: 'enum',
    enum: IndividualWorkspaceStatus,
    enumName: 'individual_workspace_status',
  })
  status: IndividualWorkspaceStatus;

  @Column({ name: 'activated_at', type: 'timestamptz', nullable: true })
  activatedAt: Date | null;

  @Column({ name: 'deactivated_at', type: 'timestamptz', nullable: true })
  deactivatedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
