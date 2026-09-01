import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'tenant_code', type: 'varchar', length: 20, unique: true })
  tenantCode: string;

  @Column({ name: 'company_name', type: 'varchar', length: 150 })
  companyName: string;

  @Column({ name: 'contact_email', type: 'varchar', length: 150, nullable: true })
  contactEmail: string;

  @Column({ name: 'contact_phone', type: 'varchar', length: 30, nullable: true })
  contactPhone: string;

  @Column({ name: 'address', type: 'text', nullable: true })
  address: string;

  @Column({ name: 'country', type: 'varchar', length: 60, nullable: true })
  country: string;

  @Column({ name: 'timezone', type: 'varchar', length: 60, default: 'UTC' })
  timezone: string;

  @Column({ name: 'base_currency', type: 'varchar', length: 3, default: 'LKR' })
  baseCurrency: string;

  @Column({ name: 'is_active', type: 'tinyint', default: 1 })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
