import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('product_categories')
@Index(['tenantId', 'categoryCode'], { unique: true })
export class ProductCategory {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'tenant_id', type: 'int' })
  @Index()
  tenantId: number;

  @Column({ name: 'category_code', type: 'varchar', length: 30 })
  categoryCode: string;

  @Column({ name: 'category_name', type: 'varchar', length: 100 })
  categoryName: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string;

  @Column({ name: 'parent_category_id', type: 'int', nullable: true })
  parentCategoryId: number;

  @Column({ name: 'is_active', type: 'tinyint', default: 1 })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
