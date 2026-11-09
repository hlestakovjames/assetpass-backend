import { CreateDateColumn, Entity, JoinColumn, OneToOne, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';
import { User } from './user.entity';

@Entity('user_profiles')
export class UserProfile {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user: User;

  @Column({ name: 'first_name', type: 'varchar', length: 100 })
  firstName: string;

  @Column({ name: 'middle_name', type: 'varchar', length: 100, nullable: true })
  middleName: string | null;

  @Column({ name: 'last_name', type: 'varchar', length: 100 })
  lastName: string;

  @Column({ name: 'phone_number', type: 'varchar', length: 40 })
  phoneNumber: string;

  @Column({ name: 'alternative_phone', type: 'varchar', length: 40, nullable: true })
  alternativePhone: string | null;

  @Column({ name: 'country_code', type: 'varchar', length: 2, default: 'KE' })
  countryCode: string;

  @Column({ type: 'varchar', length: 160, nullable: true })
  county: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  city: string | null;

  @Column({ name: 'physical_address', type: 'text', nullable: true })
  physicalAddress: string | null;

  @Column({ name: 'postal_address', type: 'varchar', length: 200, nullable: true })
  postalAddress: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  occupation: string | null;

  @Column({ name: 'preferred_contact_method', type: 'varchar', length: 20, default: 'email' })
  preferredContactMethod: string;

  @Column({ name: 'profile_photo_url', type: 'text', nullable: true })
  profilePhotoUrl: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
