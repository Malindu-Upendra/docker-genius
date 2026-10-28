import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { PosSession, SessionStatus } from './entities/pos-session.entity';
import { PosTransaction, TransactionStatus } from './entities/pos-transaction.entity';
import { PosTransactionItem } from './entities/pos-transaction-item.entity';
import { PosPayment } from './entities/pos-payment.entity';
import { Invoice, InvoiceStatus } from '../invoicing/entities/invoice.entity';
import { InvoiceItem } from '../invoicing/entities/invoice-item.entity';

interface CheckoutDto {
  sessionId: number;
  clientId?: number;
  items: {
    productId: number;
    quantity: number;
    unitPrice: number;
    discountAmount?: number;
    taxAmount?: number;
  }[];
  payments: { paymentMethodId: number; amount: number; referenceNumber?: string }[];
  discountAmount?: number;
  loyaltyPointsRedeemed?: number;
}

@Injectable()
export class PosService {
  constructor(
    @InjectRepository(PosSession) private readonly sessionRepo: Repository<PosSession>,
    @InjectRepository(PosTransaction) private readonly txRepo: Repository<PosTransaction>,
    @InjectRepository(PosTransactionItem) private readonly itemRepo: Repository<PosTransactionItem>,
    @InjectRepository(PosPayment) private readonly paymentRepo: Repository<PosPayment>,
    @InjectRepository(Invoice) private readonly invoiceRepo: Repository<Invoice>,
    @InjectRepository(InvoiceItem) private readonly invoiceItemRepo: Repository<InvoiceItem>,
    private readonly dataSource: DataSource,
  ) {}

  async openSession(tenantId: number, cashierId: number, openingCash: number): Promise<PosSession> {
    const existing = await this.sessionRepo.findOne({ where: { tenantId, cashierId, status: SessionStatus.OPEN } });
    if (existing) throw new BadRequestException('Cashier already has an open session');

    const [row] = await this.dataSource.query(
      'SELECT COUNT(*)+1 AS seq FROM pos_sessions WHERE tenant_id = ?', [tenantId]
    );
    return this.sessionRepo.save({
      tenantId, cashierId, openingCash,
      sessionNumber: `SES-${new Date().getFullYear()}-${String(row.seq).padStart(6, '0')}`,
      openedAt: new Date(), status: SessionStatus.OPEN,
    });
  }

  async closeSession(tenantId: number, sessionId: number, closingCash: number): Promise<PosSession> {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId, tenantId } });
    if (!session) throw new NotFoundException('Session not found');
    if (session.status !== SessionStatus.OPEN) throw new BadRequestException('Session already closed');
    session.status = SessionStatus.CLOSED;
    session.closingCash = closingCash;
    session.closedAt = new Date();
    return this.sessionRepo.save(session);
  }

  // TIER_1: PRIMARY research endpoint — target < 150ms p99
  // Deadlock retry loop max 3, then propagate
  async completeCheckout(tenantId: number, dto: CheckoutDto, userId: number): Promise<Invoice> {
    const MAX_RETRIES = 3;
    let lastError: Error = new Error('Checkout failed after max retries');

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.dataSource.transaction(async (manager) => {
          const subtotal = dto.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
          const taxAmount = dto.items.reduce((s, i) => s + (i.taxAmount ?? 0), 0);
          const discountAmount = dto.discountAmount ?? 0;
          const totalAmount = subtotal - discountAmount + taxAmount;
          const amountTendered = dto.payments.reduce((s, p) => s + p.amount, 0);

          // Compare in integer cents, not raw floats: a caller that rounds
          // its own total to 2dp before sending payment (as any real client
          // naturally would) can otherwise be short by a sub-cent floating-
          // point remainder against this reduce()'s unrounded sum, and get
          // spuriously rejected here even though the payment was correct to
          // the cent. Observed causing ~10% of load-test checkouts to fail
          // with "insufficient payment" despite exact-cent payment amounts.
          const toCents = (n: number) => Math.round(n * 100);
          if (toCents(amountTendered) < toCents(totalAmount)) {
            throw new BadRequestException(`Insufficient payment: tendered ${amountTendered}, required ${totalAmount}`);
          }

          // Invoice number derived from the row's own auto-increment id
          // (assigned atomically by MySQL, guaranteed unique) rather than
          // COUNT(*)+1, which two concurrent checkouts can read identically
          // before either commits. The placeholder below only needs to
          // satisfy the NOT NULL/UNIQUE constraint for the initial insert.
          const invoice = await manager.save(Invoice, {
            tenantId,
            invoiceNumber: `PENDING-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            clientId: dto.clientId ?? null,
            invoiceDate: new Date(),
            source: 'pos',
            posSessionId: dto.sessionId,
            status: InvoiceStatus.PAID,
            subtotal,
            discountAmount,
            taxAmount,
            totalAmount,
            amountPaid: totalAmount,
            balanceDue: 0,
            createdBy: userId,
          });
          invoice.invoiceNumber = `INV-${new Date().getFullYear()}-${String(invoice.id).padStart(6, '0')}`;
          await manager.save(Invoice, invoice);

          // Insert invoice items and deduct stock — sorted by productId to prevent deadlocks
          const sortedItems = [...dto.items].sort((a, b) => a.productId - b.productId);
          for (const item of sortedItems) {
            const lineTax = item.taxAmount ?? 0;
            await manager.save(InvoiceItem, {
              tenantId,
              invoiceId: invoice.id,
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discountAmount: item.discountAmount ?? 0,
              taxAmount: lineTax,
              lineTotal: item.quantity * item.unitPrice - (item.discountAmount ?? 0) + lineTax,
            });

            await manager.query(
              `UPDATE product_stocks SET qty_on_hand = qty_on_hand - ?
               WHERE product_id = ? AND tenant_id = ? AND qty_on_hand >= ?`,
              [item.quantity, item.productId, tenantId, item.quantity],
            );
          }

          // Update loyalty points if client attached
          if (dto.clientId) {
            const loyaltyPoints = Math.floor(totalAmount / 100);
            if (loyaltyPoints > 0) {
              await manager.query(
                'UPDATE clients SET loyalty_points = loyalty_points + ? WHERE id = ? AND tenant_id = ?',
                [loyaltyPoints, dto.clientId, tenantId],
              );
            }
          }

          return invoice;
        });
      } catch (err: any) {
        // ER_LOCK_DEADLOCK: concurrent transactions on the same rows.
        // ER_DUP_ENTRY: kept as a defensive retry (e.g. the placeholder
        // invoiceNumber colliding is astronomically unlikely, not
        // impossible) now that the real numbering race is gone.
        const retryable = err.code === 'ER_LOCK_DEADLOCK' || err.code === 'ER_DUP_ENTRY';
        if (retryable && attempt < MAX_RETRIES - 1) {
          lastError = err;
          continue;
        }
        throw err;
      }
    }

    throw lastError;
  }

  // TIER_1: Barcode scan — target < 20ms p99
  async scanBarcode(tenantId: number, barcode: string) {
    const [product] = await this.dataSource.query(
      `SELECT p.id, p.product_code, p.product_name, p.selling_price, p.tax_percentage,
          ps.qty_on_hand, ps.qty_reserved
        FROM products p
        JOIN product_stocks ps ON ps.product_id = p.id AND ps.tenant_id = p.tenant_id
        WHERE p.tenant_id = ? AND p.barcode = ? AND p.is_active = 1
        LIMIT 1`,
      [tenantId, barcode],
    );
    if (!product) throw new NotFoundException(`Product with barcode ${barcode} not found`);
    return product;
  }

  // TIER_1: Fast product search for POS — target < 50ms
  async searchProducts(tenantId: number, query: string) {
    return this.dataSource.query(
      `SELECT p.id, p.product_code, p.product_name, p.barcode, p.selling_price, p.tax_percentage,
          ps.qty_on_hand - ps.qty_reserved AS available_qty
        FROM products p
        JOIN product_stocks ps ON ps.product_id = p.id AND ps.tenant_id = p.tenant_id
        WHERE p.tenant_id = ? AND p.is_active = 1
          AND (p.product_name LIKE ? OR p.product_code LIKE ? OR p.barcode LIKE ?)
        LIMIT 10`,
      [tenantId, `%${query}%`, `%${query}%`, `%${query}%`],
    );
  }

  async getSession(tenantId: number, cashierId: number) {
    return this.sessionRepo.findOne({ where: { tenantId, cashierId, status: SessionStatus.OPEN } });
  }

  async getTransactions(tenantId: number, sessionId?: number, page = 1, limit = 20) {
    const qb = this.txRepo.createQueryBuilder('t').where('t.tenantId = :tenantId', { tenantId });
    if (sessionId) qb.andWhere('t.sessionId = :sessionId', { sessionId });
    const [items, total] = await qb.skip((page - 1) * limit).take(limit).orderBy('t.transactionTime', 'DESC').getManyAndCount();
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getTransaction(tenantId: number, id: number) {
    const tx = await this.txRepo.findOne({ where: { id, tenantId } });
    if (!tx) throw new NotFoundException('Transaction not found');
    const items = await this.itemRepo.find({ where: { transactionId: id, tenantId } });
    const payments = await this.paymentRepo.find({ where: { transactionId: id, tenantId } });
    return { ...tx, items, payments };
  }

  async voidTransaction(tenantId: number, id: number): Promise<PosTransaction> {
    const tx = await this.txRepo.findOne({ where: { id, tenantId } });
    if (!tx) throw new NotFoundException();
    if (tx.status === TransactionStatus.VOID) throw new BadRequestException('Already voided');

    return this.dataSource.transaction(async (manager) => {
      const items = await this.itemRepo.find({ where: { transactionId: id, tenantId } });
      for (const item of items) {
        await manager.query(
          'UPDATE product_stocks SET qty_on_hand = qty_on_hand + ? WHERE product_id = ? AND tenant_id = ?',
          [item.quantity, item.productId, tenantId],
        );
      }
      tx.status = TransactionStatus.VOID;
      return manager.save(tx);
    });
  }
}
