import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export enum GrunStatus {
  DRAFT = 'draft',
  SUBMITTED = 'submitted',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export enum GrunType {
  FROM_GRN = 'from_grn',
  STANDALONE = 'standalone',
}

@Entity('grun_headers')
@Index(['tenantId', 'grunNumber'], { unique: true })
export class GrunHeader {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'tenant_id', type: 'int' })
  @Index()
  tenantId: number;

  @Column({ name: 'grun_number', type: 'varchar', length: 50 })
  grunNumber: string;

  @Column({ name: 'grn_id', type: 'int', nullable: true })
  grnId: number;

  @Column({ name: 'supplier_id', type: 'int' })
  supplierId: number;

  @Column({ name: 'grun_type', type: 'enum', enum: GrunType, default: GrunType.FROM_GRN })
  grunType: GrunType;

  @Column({ name: 'return_date', type: 'date' })
  returnDate: Date;

  @Column({ name: 'status', type: 'enum', enum: GrunStatus, default: GrunStatus.DRAFT })
  @Index()
  status: GrunStatus;

  @Column({ name: 'total_quantity', type: 'decimal', precision: 15, scale: 4, default: 0 })
  totalQuantity: number;

  @Column({ name: 'total_cost', type: 'decimal', precision: 15, scale: 2, default: 0 })
  totalCost: number;

  @Column({ name: 'return_reason', type: 'varchar', length: 255, nullable: true })
  returnReason: string;

  @Column({ name: 'supplier_credit_note', type: 'varchar', length: 100, nullable: true })
  supplierCreditNote: string;

  @Column({ name: 'approved_by', type: 'int', nullable: true })
  approvedBy: number;

  @Column({ name: 'approved_at', type: 'datetime', nullable: true })
  approvedAt: Date;

  @Column({ name: 'created_by', type: 'int' })
  createdBy: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
