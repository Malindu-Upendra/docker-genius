import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export enum ProductType {
  SIMPLE = 'simple',
  VARIANT = 'variant',
  BUNDLE = 'bundle',
  SERVICE = 'service',
}

@Entity('products')
@Index(['tenantId', 'productCode'], { unique: true })
@Index(['tenantId', 'barcode'])
export class Product {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'tenant_id', type: 'int' })
  @Index()
  tenantId: number;

  @Column({ name: 'product_code', type: 'varchar', length: 50 })
  productCode: string;

  @Column({ name: 'product_name', type: 'varchar', length: 200 })
  productName: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string;

  @Column({ name: 'category_id', type: 'int', nullable: true })
  categoryId: number;

  @Column({ name: 'brand_id', type: 'int', nullable: true })
  brandId: number;

  @Column({ name: 'unit_id', type: 'int', nullable: true })
  unitId: number;

  @Column({ name: 'product_type', type: 'enum', enum: ProductType, default: ProductType.SIMPLE })
  productType: ProductType;

  @Column({ name: 'barcode', type: 'varchar', length: 100, nullable: true })
  barcode: string;

  @Column({ name: 'cost_price', type: 'decimal', precision: 15, scale: 4, default: 0 })
  costPrice: number;

  @Column({ name: 'selling_price', type: 'decimal', precision: 15, scale: 4, default: 0 })
  sellingPrice: number;

  @Column({ name: 'tax_percentage', type: 'decimal', precision: 5, scale: 2, default: 0 })
  taxPercentage: number;

  @Column({ name: 'reorder_level', type: 'decimal', precision: 15, scale: 4, default: 0 })
  reorderLevel: number;

  @Column({ name: 'image_url', type: 'varchar', length: 500, nullable: true })
  imageUrl: string;

  @Column({ name: 'is_active', type: 'tinyint', default: 1 })
  isActive: boolean;

  @Column({ name: 'is_tracked', type: 'tinyint', default: 1 })
  isTracked: boolean;

  @Column({ name: 'has_serial', type: 'tinyint', default: 0 })
  hasSerial: boolean;

  @Column({ name: 'has_batch', type: 'tinyint', default: 0 })
  hasBatch: boolean;

  @Column({ name: 'has_expiry', type: 'tinyint', default: 0 })
  hasExpiry: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
