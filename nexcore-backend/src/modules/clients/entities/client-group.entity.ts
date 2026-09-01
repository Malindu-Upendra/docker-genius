import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity('client_groups')
@Index(['tenantId', 'groupCode'], { unique: true })
export class ClientGroup {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'tenant_id', type: 'int' })
  @Index()
  tenantId: number;

  @Column({ name: 'group_code', type: 'varchar', length: 30 })
  groupCode: string;

  @Column({ name: 'group_name', type: 'varchar', length: 100 })
  groupName: string;

  @Column({ name: 'default_credit_limit', type: 'decimal', precision: 15, scale: 2, default: 0 })
  defaultCreditLimit: number;

  @Column({ name: 'discount_percentage', type: 'decimal', precision: 5, scale: 2, default: 0 })
  discountPercentage: number;

  @Column({ name: 'is_active', type: 'tinyint', default: 1 })
  isActive: boolean;
}
