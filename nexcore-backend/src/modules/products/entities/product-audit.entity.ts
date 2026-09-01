import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

@Entity('product_audit_logs')
@Index(['tenantId', 'productId', 'createdAt'])
export class ProductAuditLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'tenant_id', type: 'int' })
  @Index()
  tenantId: number;

  @Column({ name: 'product_id', type: 'int' })
  productId: number;

  @Column({ name: 'action', type: 'varchar', length: 50 })
  action: string;

  @Column({ name: 'changed_by', type: 'int' })
  changedBy: number;

  @Column({ name: 'old_values', type: 'json', nullable: true })
  oldValues: Record<string, any>;

  @Column({ name: 'new_values', type: 'json', nullable: true })
  newValues: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
