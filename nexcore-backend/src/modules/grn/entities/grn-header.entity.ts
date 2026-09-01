import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export enum GrnStatus {
  DRAFT = 'draft',
  SUBMITTED = 'submitted',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PARTIAL = 'partial',
}

@Entity('grn_headers')
@Index(['tenantId', 'grnNumber'], { unique: true })
export class GrnHeader {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'tenant_id', type: 'int' })
  @Index()
  tenantId: number;

  @Column({ name: 'grn_number', type: 'varchar', length: 50 })
  grnNumber: string;

  @Column({ name: 'supplier_id', type: 'int' })
  supplierId: number;

  @Column({ name: 'reference_number', type: 'varchar', length: 100, nullable: true })
  referenceNumber: string;

  @Column({ name: 'purchase_order_id', type: 'int', nullable: true })
  purchaseOrderId: number;

  @Column({ name: 'received_date', type: 'date' })
  receivedDate: Date;

  @Column({ name: 'status', type: 'enum', enum: GrnStatus, default: GrnStatus.DRAFT })
  @Index()
  status: GrnStatus;

  @Column({ name: 'total_quantity', type: 'decimal', precision: 15, scale: 4, default: 0 })
  totalQuantity: number;

  @Column({ name: 'total_cost', type: 'decimal', precision: 15, scale: 2, default: 0 })
  totalCost: number;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes: string;

  @Column({ name: 'approved_by', type: 'int', nullable: true })
  approvedBy: number;

  @Column({ name: 'approved_at', type: 'datetime', nullable: true })
  approvedAt: Date;

  @Column({ name: 'rejected_by', type: 'int', nullable: true })
  rejectedBy: number;

  @Column({ name: 'rejected_at', type: 'datetime', nullable: true })
  rejectedAt: Date;

  @Column({ name: 'rejection_reason', type: 'varchar', length: 255, nullable: true })
  rejectionReason: string;

  @Column({ name: 'created_by', type: 'int' })
  createdBy: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
