import { Entity, Column, PrimaryGeneratedColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('product_stocks')
@Index(['tenantId', 'productId'], { unique: true })
export class ProductStock {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'tenant_id', type: 'int' })
  @Index()
  tenantId: number;

  @Column({ name: 'product_id', type: 'int' })
  productId: number;

  @Column({ name: 'qty_on_hand', type: 'decimal', precision: 15, scale: 4, default: 0 })
  qtyOnHand: number;

  @Column({ name: 'qty_reserved', type: 'decimal', precision: 15, scale: 4, default: 0 })
  qtyReserved: number;

  @Column({ name: 'qty_on_order', type: 'decimal', precision: 15, scale: 4, default: 0 })
  qtyOnOrder: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
