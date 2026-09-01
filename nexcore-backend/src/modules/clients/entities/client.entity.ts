import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('clients')
@Index(['tenantId', 'clientCode'], { unique: true })
export class Client {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'tenant_id', type: 'int' })
  @Index()
  tenantId: number;

  @Column({ name: 'client_code', type: 'varchar', length: 30 })
  clientCode: string;

  @Column({ name: 'client_name', type: 'varchar', length: 150 })
  clientName: string;

  @Column({ name: 'client_group_id', type: 'int', nullable: true })
  clientGroupId: number;

  @Column({ name: 'contact_person', type: 'varchar', length: 100, nullable: true })
  contactPerson: string;

  @Column({ name: 'email', type: 'varchar', length: 150, nullable: true })
  email: string;

  @Column({ name: 'phone', type: 'varchar', length: 30, nullable: true })
  phone: string;

  @Column({ name: 'address', type: 'text', nullable: true })
  address: string;

  @Column({ name: 'city', type: 'varchar', length: 80, nullable: true })
  city: string;

  @Column({ name: 'country', type: 'varchar', length: 60, nullable: true })
  country: string;

  @Column({ name: 'tax_number', type: 'varchar', length: 50, nullable: true })
  taxNumber: string;

  @Column({ name: 'credit_limit', type: 'decimal', precision: 15, scale: 2, default: 0 })
  creditLimit: number;

  @Column({ name: 'current_balance', type: 'decimal', precision: 15, scale: 2, default: 0 })
  currentBalance: number;

  @Column({ name: 'loyalty_points', type: 'int', default: 0 })
  loyaltyPoints: number;

  @Column({ name: 'sales_rep_id', type: 'int', nullable: true })
  salesRepId: number;

  @Column({ name: 'payment_terms_id', type: 'int', nullable: true })
  paymentTermsId: number;

  @Column({ name: 'is_active', type: 'tinyint', default: 1 })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
