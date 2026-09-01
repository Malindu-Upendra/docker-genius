import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

export enum ItemCondition {
  DAMAGED = 'damaged',
  EXPIRED = 'expired',
  WRONG_ITEM = 'wrong_item',
  EXCESS = 'excess',
  QUALITY_ISSUE = 'quality_issue',
}

@Entity('grun_items')
@Index(['tenantId', 'grunId'])
export class GrunItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'tenant_id', type: 'int' })
  tenantId: number;

  @Column({ name: 'grun_id', type: 'int' })
  grunId: number;

  @Column({ name: 'grn_item_id', type: 'int', nullable: true })
  grnItemId: number;

  @Column({ name: 'product_id', type: 'int' })
  productId: number;

  @Column({ name: 'return_qty', type: 'decimal', precision: 15, scale: 4 })
  returnQty: number;

  @Column({ name: 'unit_cost', type: 'decimal', precision: 15, scale: 4 })
  unitCost: number;

  @Column({ name: 'line_total', type: 'decimal', precision: 15, scale: 2, default: 0 })
  lineTotal: number;

  @Column({ name: 'item_condition', type: 'enum', enum: ItemCondition, nullable: true })
  itemCondition: ItemCondition;

  @Column({ name: 'notes', type: 'varchar', length: 255, nullable: true })
  notes: string;
}
