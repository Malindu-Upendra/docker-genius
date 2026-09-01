import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity('product_units')
@Index(['tenantId', 'unitCode'], { unique: true })
export class ProductUnit {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'tenant_id', type: 'int' })
  @Index()
  tenantId: number;

  @Column({ name: 'unit_code', type: 'varchar', length: 20 })
  unitCode: string;

  @Column({ name: 'unit_name', type: 'varchar', length: 60 })
  unitName: string;

  @Column({ name: 'is_active', type: 'tinyint', default: 1 })
  isActive: boolean;
}
