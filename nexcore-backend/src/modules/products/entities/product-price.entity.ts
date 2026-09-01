import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export enum PriceType {
  RETAIL = 'retail',
  WHOLESALE = 'wholesale',
  SPECIAL = 'special',
  PROMO = 'promo',
}

@Entity('product_prices')
@Index(['tenantId', 'productId', 'priceType', 'clientGroupId'], { unique: true })
export class ProductPrice {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'tenant_id', type: 'int' })
  @Index()
  tenantId: number;

  @Column({ name: 'product_id', type: 'int' })
  productId: number;

  @Column({ name: 'price_type', type: 'enum', enum: PriceType, default: PriceType.RETAIL })
  priceType: PriceType;

  @Column({ name: 'client_group_id', type: 'int', nullable: true })
  clientGroupId: number;

  @Column({ name: 'price', type: 'decimal', precision: 15, scale: 4 })
  price: number;

  @Column({ name: 'valid_from', type: 'date', nullable: true })
  validFrom: Date;

  @Column({ name: 'valid_to', type: 'date', nullable: true })
  validTo: Date;

  @Column({ name: 'is_active', type: 'tinyint', default: 1 })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
