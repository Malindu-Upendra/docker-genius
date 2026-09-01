import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

export enum AdjustmentType {
  MANUAL_IN = 'manual_in',
  MANUAL_OUT = 'manual_out',
  DAMAGE = 'damage',
  EXPIRY = 'expiry',
  RECOUNT = 'recount',
  RETURN = 'return',
}

@Entity('stock_adjustments')
@Index(['tenantId', 'productId', 'createdAt'])
export class StockAdjustment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'tenant_id', type: 'int' })
  @Index()
  tenantId: number;

  @Column({ name: 'product_id', type: 'int' })
  productId: number;

  @Column({ name: 'adjustment_type', type: 'enum', enum: AdjustmentType })
  adjustmentType: AdjustmentType;

  @Column({ name: 'quantity', type: 'decimal', precision: 15, scale: 4 })
  quantity: number;

  @Column({ name: 'reason', type: 'varchar', length: 255 })
  reason: string;

  @Column({ name: 'reference_number', type: 'varchar', length: 50, nullable: true })
  referenceNumber: string;

  @Column({ name: 'adjusted_by', type: 'int' })
  adjustedBy: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
