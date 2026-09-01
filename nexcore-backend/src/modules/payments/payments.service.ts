import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Payment, PaymentStatus } from './entities/payment.entity';
import { PaymentAllocation } from './entities/payment-allocation.entity';

interface CreatePaymentDto {
  clientId: number;
  paymentMethodId: number;
  paymentDate: Date;
  amount: number;
  referenceNumber?: string;
  chequeNumber?: string;
  chequeDate?: Date;
  chequeBank?: string;
  notes?: string;
  allocations?: { invoiceId: number; amount: number }[];
}

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(Payment) private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(PaymentAllocation) private readonly allocationRepo: Repository<PaymentAllocation>,
    private readonly dataSource: DataSource,
  ) {}

  private async nextPaymentNumber(tenantId: number): Promise<string> {
    const [row] = await this.dataSource.query(
      'SELECT COUNT(*)+1 AS seq FROM payments WHERE tenant_id = ?', [tenantId]
    );
    return `PAY-${new Date().getFullYear()}-${String(row.seq).padStart(6, '0')}`;
  }

  // Creates payment as PENDING — invoice balances not touched yet
  async create(tenantId: number, dto: CreatePaymentDto, userId: number): Promise<Payment> {
    return this.dataSource.transaction(async (manager) => {
      const paymentNumber = await this.nextPaymentNumber(tenantId);

      const payment = await manager.save(Payment, {
        tenantId, paymentNumber, clientId: dto.clientId,
        paymentMethodId: dto.paymentMethodId, paymentDate: dto.paymentDate,
        amount: dto.amount, baseAmount: dto.amount,
        status: PaymentStatus.PENDING,
        referenceNumber: dto.referenceNumber, chequeNumber: dto.chequeNumber,
        chequeDate: dto.chequeDate, chequeBank: dto.chequeBank,
        notes: dto.notes, createdBy: userId,
      });

      // Save allocations only — do NOT update invoice balances until approved
      if (dto.allocations?.length) {
        let remaining = dto.amount;
        for (const alloc of dto.allocations) {
          if (remaining <= 0) break;
          const allocAmt = Math.min(alloc.amount, remaining);
          await manager.save(PaymentAllocation, {
            tenantId, paymentId: payment.id, invoiceId: alloc.invoiceId, allocatedAmount: allocAmt,
          });
          remaining -= allocAmt;
        }
      }

      return payment;
    });
  }

  // Approve: confirm payment and reduce invoice open balances
  async approve(tenantId: number, id: number, userId: number): Promise<Payment> {
    return this.dataSource.transaction(async (manager) => {
      const payment = await manager.findOne(Payment, { where: { id, tenantId } });
      if (!payment) throw new NotFoundException('Payment not found');
      if (payment.status !== PaymentStatus.PENDING) throw new BadRequestException('Only PENDING payments can be approved');

      const allocations = await this.allocationRepo.find({ where: { paymentId: id, tenantId } });

      for (const alloc of allocations) {
        await manager.query(
          `UPDATE invoices
             SET amount_paid  = amount_paid  + ?,
                 balance_due  = balance_due  - ?,
                 status = CASE WHEN (balance_due - ?) <= 0 THEN 'paid' ELSE 'partial' END
           WHERE id = ? AND tenant_id = ?`,
          [alloc.allocatedAmount, alloc.allocatedAmount, alloc.allocatedAmount, alloc.invoiceId, tenantId],
        );
      }

      // Reduce client balance
      await manager.query(
        'UPDATE clients SET current_balance = current_balance - ? WHERE id = ? AND tenant_id = ?',
        [payment.baseAmount, payment.clientId, tenantId],
      );

      payment.status = PaymentStatus.CONFIRMED;
      return manager.save(Payment, payment);
    });
  }

  // Cancel: discard a PENDING payment — no invoice reversal needed
  async cancel(tenantId: number, id: number, userId: number): Promise<Payment> {
    const payment = await this.paymentRepo.findOne({ where: { id, tenantId } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status !== PaymentStatus.PENDING) throw new BadRequestException('Only PENDING payments can be cancelled');
    payment.status = PaymentStatus.VOID;
    payment.voidedBy = userId;
    payment.voidedAt = new Date();
    return this.paymentRepo.save(payment);
  }

  // Void: reverse a CONFIRMED payment (restores invoice balances)
  async voidPayment(tenantId: number, id: number, userId: number): Promise<Payment> {
    return this.dataSource.transaction(async (manager) => {
      const payment = await manager.findOne(Payment, { where: { id, tenantId } });
      if (!payment) throw new NotFoundException();
      if (payment.status === PaymentStatus.VOID) throw new BadRequestException('Already voided');
      if (payment.status !== PaymentStatus.CONFIRMED) throw new BadRequestException('Only CONFIRMED payments can be voided');

      const allocations = await this.allocationRepo.find({ where: { paymentId: id, tenantId } });
      for (const alloc of allocations) {
        await manager.query(
          `UPDATE invoices
             SET amount_paid = amount_paid - ?,
                 balance_due = balance_due + ?,
                 status = CASE WHEN (balance_due + ?) > 0 THEN 'confirmed' ELSE status END
           WHERE id = ? AND tenant_id = ?`,
          [alloc.allocatedAmount, alloc.allocatedAmount, alloc.allocatedAmount, alloc.invoiceId, tenantId],
        );
      }

      await manager.query(
        'UPDATE clients SET current_balance = current_balance + ? WHERE id = ? AND tenant_id = ?',
        [payment.baseAmount, payment.clientId, tenantId],
      );

      payment.status = PaymentStatus.VOID;
      payment.voidedBy = userId;
      payment.voidedAt = new Date();
      return manager.save(Payment, payment);
    });
  }

  async findAll(tenantId: number, clientId?: number, status?: string, page = 1, limit = 20) {
    const qb = this.paymentRepo.createQueryBuilder('p').where('p.tenantId = :tenantId', { tenantId });
    if (clientId) qb.andWhere('p.clientId = :clientId', { clientId });
    if (status) qb.andWhere('p.status = :status', { status });
    const [items, total] = await qb.skip((page - 1) * limit).take(limit).orderBy('p.createdAt', 'DESC').getManyAndCount();

    const clientIds = [...new Set(items.map(i => i.clientId).filter(Boolean))];
    let clientMap: Record<number, string> = {};
    if (clientIds.length > 0) {
      const rows: any[] = await this.dataSource.query(
        `SELECT id, client_name FROM clients WHERE id IN (${clientIds.map(() => '?').join(',')})`, clientIds,
      );
      clientMap = Object.fromEntries(rows.map(r => [r.id, r.client_name]));
    }
    const enriched = items.map(i => ({ ...i, clientName: clientMap[i.clientId] ?? '—' }));
    return { items: enriched, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(tenantId: number, id: number) {
    const payment = await this.paymentRepo.findOne({ where: { id, tenantId } });
    if (!payment) throw new NotFoundException(`Payment ${id} not found`);
    const allocations = await this.allocationRepo.find({ where: { paymentId: id, tenantId } });
    const [client] = await this.dataSource.query(
      'SELECT client_name, client_code FROM clients WHERE id = ? LIMIT 1', [payment.clientId],
    );
    // Enrich allocations with invoice numbers
    const invoiceIds = allocations.map(a => a.invoiceId);
    let invoiceMap: Record<number, string> = {};
    if (invoiceIds.length > 0) {
      const rows: any[] = await this.dataSource.query(
        `SELECT id, invoice_number FROM invoices WHERE id IN (${invoiceIds.map(() => '?').join(',')})`, invoiceIds,
      );
      invoiceMap = Object.fromEntries(rows.map(r => [r.id, r.invoice_number]));
    }
    const enrichedAllocations = allocations.map(a => ({ ...a, invoiceNumber: invoiceMap[a.invoiceId] ?? String(a.invoiceId) }));
    return { ...payment, allocations: enrichedAllocations, clientName: client?.client_name ?? '—', clientCode: client?.client_code };
  }

  async getOutstandingByClient(tenantId: number, clientId: number) {
    return this.dataSource.query(
      `SELECT i.id, i.invoice_number, i.invoice_date, i.due_date,
          i.total_amount, i.amount_paid, i.balance_due, i.status,
          DATEDIFF(CURDATE(), i.due_date) AS days_overdue
        FROM invoices i
        WHERE i.tenant_id = ? AND i.client_id = ? AND i.balance_due > 0 AND i.status NOT IN ('void','draft','paid')
        ORDER BY i.due_date ASC`,
      [tenantId, clientId],
    );
  }

  // TIER_3: Aged receivables
  async getAgedReceivables(tenantId: number) {
    return this.dataSource.query(
      `SELECT c.client_code, c.client_name,
          SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) <= 0 THEN i.balance_due ELSE 0 END) AS current_due,
          SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) BETWEEN 1 AND 30 THEN i.balance_due ELSE 0 END) AS days_1_30,
          SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) BETWEEN 31 AND 60 THEN i.balance_due ELSE 0 END) AS days_31_60,
          SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) BETWEEN 61 AND 90 THEN i.balance_due ELSE 0 END) AS days_61_90,
          SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) > 90 THEN i.balance_due ELSE 0 END) AS over_90,
          SUM(i.balance_due) AS total_overdue
        FROM clients c
        JOIN invoices i ON i.client_id = c.id AND i.tenant_id = c.tenant_id
        WHERE c.tenant_id = ? AND i.balance_due > 0 AND i.status NOT IN ('void', 'draft')
        GROUP BY c.id, c.client_code, c.client_name
        ORDER BY total_overdue DESC`,
      [tenantId],
    );
  }

  // TIER_3: Payment collection report
  async getCollectionReport(tenantId: number, fromDate?: Date, toDate?: Date) {
    const params: any[] = [tenantId];
    let dateFilter = '';
    if (fromDate) { dateFilter += ' AND p.payment_date >= ?'; params.push(fromDate); }
    if (toDate) { dateFilter += ' AND p.payment_date <= ?'; params.push(toDate); }

    return this.dataSource.query(
      `SELECT p.payment_method_id AS method,
          c.client_code, c.client_name,
          COUNT(p.id) AS payment_count,
          SUM(p.amount) AS total_collected,
          SUM(CASE WHEN p.status = 'void' THEN p.amount ELSE 0 END) AS total_voided,
          SUM(CASE WHEN p.status = 'confirmed' THEN p.amount ELSE 0 END) AS net_collected
        FROM payments p
        JOIN clients c ON c.id = p.client_id AND c.tenant_id = p.tenant_id
        WHERE p.tenant_id = ?${dateFilter}
        GROUP BY p.payment_method_id, c.id, c.client_code, c.client_name
        ORDER BY net_collected DESC`,
      params,
    );
  }

  async getDashboard(tenantId: number) {
    const [totalReceived] = await this.dataSource.query(
      `SELECT SUM(amount) AS total FROM payments WHERE tenant_id = ? AND status = 'confirmed'
       AND payment_date >= DATE_FORMAT(NOW(), '%Y-%m-01')`, [tenantId]
    );
    const [overdueTotal] = await this.dataSource.query(
      `SELECT SUM(balance_due) AS total FROM invoices WHERE tenant_id = ?
       AND balance_due > 0 AND due_date < CURDATE() AND status != 'void'`, [tenantId]
    );
    return { monthlyReceived: totalReceived.total, overdueAmount: overdueTotal.total };
  }
}
