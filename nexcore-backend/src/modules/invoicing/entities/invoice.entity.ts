import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export enum InvoiceStatus {
  DRAFT = 'draft',
  CONFIRMED = 'confirmed',
  PARTIAL = 'partial',
  PAID = 'paid',
  VOID = 'void',
}

@Entity('invoices')
@Index(['tenantId', 'invoiceNumber'], { unique: true })
@Index(['tenantId', 'clientId', 'status'])
export class Invoice {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'tenant_id', type: 'int' })
  @Index()
  tenantId: number;

  @Column({ name: 'invoice_number', type: 'varchar', length: 50 })
  invoiceNumber: string;

  @Column({ name: 'client_id', type: 'int', nullable: true })
  clientId: number;

  @Column({ name: 'source', type: 'enum', enum: ['manual', 'pos'], default: 'manual' })
  source: string;

  @Column({ name: 'pos_session_id', type: 'int', nullable: true })
  posSessionId: number;

  @Column({ name: 'invoice_date', type: 'date' })
  invoiceDate: Date;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate: Date;

  @Column({ name: 'status', type: 'enum', enum: InvoiceStatus, default: InvoiceStatus.DRAFT })
  @Index()
  status: InvoiceStatus;

  @Column({ name: 'subtotal', type: 'decimal', precision: 15, scale: 2, default: 0 })
  subtotal: number;

  @Column({ name: 'discount_amount', type: 'decimal', precision: 15, scale: 2, default: 0 })
  discountAmount: number;

  @Column({ name: 'tax_amount', type: 'decimal', precision: 15, scale: 2, default: 0 })
  taxAmount: number;

  @Column({ name: 'total_amount', type: 'decimal', precision: 15, scale: 2, default: 0 })
  totalAmount: number;

  @Column({ name: 'amount_paid', type: 'decimal', precision: 15, scale: 2, default: 0 })
  amountPaid: number;

  @Column({ name: 'balance_due', type: 'decimal', precision: 15, scale: 2, default: 0 })
  balanceDue: number;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes: string;

  @Column({ name: 'payment_terms_id', type: 'int', nullable: true })
  paymentTermsId: number;

  @Column({ name: 'created_by', type: 'int' })
  createdBy: number;

  @Column({ name: 'voided_by', type: 'int', nullable: true })
  voidedBy: number;

  @Column({ name: 'voided_at', type: 'datetime', nullable: true })
  voidedAt: Date;

  @Column({ name: 'void_reason', type: 'varchar', length: 255, nullable: true })
  voidReason: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
