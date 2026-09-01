import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

@Entity('payment_allocations')
@Index(['tenantId', 'paymentId'])
@Index(['tenantId', 'invoiceId'])
export class PaymentAllocation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'tenant_id', type: 'int' })
  tenantId: number;

  @Column({ name: 'payment_id', type: 'int' })
  paymentId: number;

  @Column({ name: 'invoice_id', type: 'int' })
  invoiceId: number;

  @Column({ name: 'allocated_amount', type: 'decimal', precision: 15, scale: 2 })
  allocatedAmount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
