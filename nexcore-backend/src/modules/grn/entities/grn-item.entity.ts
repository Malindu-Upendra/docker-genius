import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity('grn_items')
@Index(['tenantId', 'grnId'])
export class GrnItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'tenant_id', type: 'int' })
  tenantId: number;

  @Column({ name: 'grn_id', type: 'int' })
  grnId: number;

  @Column({ name: 'product_id', type: 'int' })
  productId: number;

  @Column({ name: 'qty', type: 'decimal', precision: 15, scale: 4, default: 0 })
  qty: number;

  @Column({ name: 'unit_cost', type: 'decimal', precision: 15, scale: 4 })
  unitCost: number;

  @Column({ name: 'line_total', type: 'decimal', precision: 15, scale: 2, default: 0 })
  lineTotal: number;

  @Column({ name: 'batch_number', type: 'varchar', length: 100, nullable: true })
  batchNumber: string;

  @Column({ name: 'expiry_date', type: 'date', nullable: true })
  expiryDate: Date;

  @Column({ name: 'notes', type: 'varchar', length: 255, nullable: true })
  notes: string;
}
