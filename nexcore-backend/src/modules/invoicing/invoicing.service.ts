import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Invoice, InvoiceStatus } from './entities/invoice.entity';
import { InvoiceItem } from './entities/invoice-item.entity';

interface CreateInvoiceDto {
  clientId: number;
  invoiceDate: Date;
  paymentTermsId?: number;
  notes?: string;
  discountAmount?: number;
  items: {
    productId: number;
    quantity: number;
    unitPrice: number;
    discountPercentage?: number;
    taxPercentage?: number;
  }[];
}

@Injectable()
export class InvoicingService {
  constructor(
    @InjectRepository(Invoice) private readonly invoiceRepo: Repository<Invoice>,
    @InjectRepository(InvoiceItem) private readonly itemRepo: Repository<InvoiceItem>,
    private readonly dataSource: DataSource,
  ) {}

  private async nextInvoiceNumber(tenantId: number): Promise<string> {
    const [row] = await this.dataSource.query(
      'SELECT COUNT(*)+1 AS seq FROM invoices WHERE tenant_id = ?', [tenantId]
    );
    return `INV-${new Date().getFullYear()}-${String(row.seq).padStart(6, '0')}`;
  }

  private calcTotals(items: CreateInvoiceDto['items'], headerDiscount = 0) {
    let subtotal = 0;
    let taxAmount = 0;
    const lineItems = items.map(item => {
      const gross = item.quantity * item.unitPrice;
      const discAmt = gross * ((item.discountPercentage ?? 0) / 100);
      const net = gross - discAmt;
      const tax = net * ((item.taxPercentage ?? 0) / 100);
      subtotal += gross;
      taxAmount += tax;
      return { ...item, discountAmount: discAmt, taxAmount: tax, lineTotal: net + tax };
    });
    const totalAmount = subtotal - headerDiscount + taxAmount;
    return { lineItems, subtotal, taxAmount, totalAmount, balanceDue: totalAmount };
  }

  async create(tenantId: number, dto: CreateInvoiceDto, userId: number): Promise<Invoice> {
    return this.dataSource.transaction(async (manager) => {
      const invoiceNumber = await this.nextInvoiceNumber(tenantId);
      const { lineItems, subtotal, taxAmount, totalAmount, balanceDue } = this.calcTotals(dto.items, dto.discountAmount ?? 0);

      const invoice = await manager.save(Invoice, {
        tenantId, invoiceNumber, clientId: dto.clientId,
        invoiceDate: dto.invoiceDate, paymentTermsId: dto.paymentTermsId,
        notes: dto.notes, subtotal, discountAmount: dto.discountAmount ?? 0,
        taxAmount, totalAmount, balanceDue, status: InvoiceStatus.DRAFT, createdBy: userId,
      });

      for (const item of lineItems) {
        await manager.save(InvoiceItem, { tenantId, invoiceId: invoice.id, ...item });
      }

      return invoice;
    });
  }

  async findAll(tenantId: number, clientId?: number, status?: string, page = 1, limit = 20) {
    const qb = this.invoiceRepo.createQueryBuilder('i')
      .where('i.tenantId = :tenantId', { tenantId });
    if (clientId) qb.andWhere('i.clientId = :clientId', { clientId });
    if (status) qb.andWhere('i.status = :status', { status });
    let [items, total] = await qb.skip((page - 1) * limit).take(limit).orderBy('i.createdAt', 'DESC').getManyAndCount();

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
    const invoice = await this.invoiceRepo.findOne({ where: { id, tenantId } });
    if (!invoice) throw new NotFoundException(`Invoice ${id} not found`);
    const items = await this.itemRepo.find({ where: { invoiceId: id, tenantId } });
    const [client] = await this.dataSource.query(
      'SELECT client_name, client_code FROM clients WHERE id = ? LIMIT 1', [invoice.clientId],
    );
    return { ...invoice, items, clientName: client?.client_name ?? '—', clientCode: client?.client_code };
  }

  async confirm(tenantId: number, id: number, userId: number): Promise<Invoice> {
    return this.dataSource.transaction(async (manager) => {
      const invoice = await manager.findOne(Invoice, { where: { id, tenantId } });
      if (!invoice) throw new NotFoundException();
      if (invoice.source === 'pos') throw new BadRequestException('POS invoices are settled at checkout and cannot be confirmed manually');
      if (invoice.status !== InvoiceStatus.DRAFT) throw new BadRequestException('Only DRAFT invoices can be confirmed');

      const items = await this.itemRepo.find({ where: { invoiceId: id, tenantId } });

      // Deduct stock — sort by productId to prevent deadlocks (same pattern as POS)
      const sorted = [...items].sort((a, b) => a.productId - b.productId);
      for (const item of sorted) {
        await manager.query(
          `UPDATE product_stocks SET qty_on_hand = qty_on_hand - ?
           WHERE product_id = ? AND tenant_id = ? AND qty_on_hand >= ?`,
          [Number(item.quantity), item.productId, tenantId, Number(item.quantity)],
        );
      }

      invoice.status = InvoiceStatus.CONFIRMED;
      return manager.save(Invoice, invoice);
    });
  }

  async voidInvoice(tenantId: number, id: number, userId: number, reason: string): Promise<Invoice> {
    return this.dataSource.transaction(async (manager) => {
      const invoice = await manager.findOne(Invoice, { where: { id, tenantId } });
      if (!invoice) throw new NotFoundException();
      if (invoice.status === InvoiceStatus.VOID) throw new BadRequestException('Invoice already voided');
      if (Number(invoice.amountPaid) > 0) throw new BadRequestException('Cannot void invoice with payments applied');

      // Restore stock only if it was already deducted (confirmed or beyond)
      const stockDeducted = [InvoiceStatus.CONFIRMED, InvoiceStatus.PARTIAL, InvoiceStatus.PAID].includes(invoice.status);
      if (stockDeducted) {
        const items = await this.itemRepo.find({ where: { invoiceId: id, tenantId } });
        for (const item of items) {
          await manager.query(
            'UPDATE product_stocks SET qty_on_hand = qty_on_hand + ? WHERE product_id = ? AND tenant_id = ?',
            [Number(item.quantity), item.productId, tenantId],
          );
        }
      }

      invoice.status = InvoiceStatus.VOID;
      invoice.voidedBy = userId;
      invoice.voidedAt = new Date();
      invoice.voidReason = reason;
      return manager.save(Invoice, invoice);
    });
  }

  async applyPayment(tenantId: number, invoiceId: number, amount: number): Promise<Invoice> {
    const invoice = await this.invoiceRepo.findOne({ where: { id: invoiceId, tenantId } });
    if (!invoice) throw new NotFoundException();

    invoice.amountPaid = Number(invoice.amountPaid) + amount;
    invoice.balanceDue = Number(invoice.totalAmount) - Number(invoice.amountPaid);
    invoice.status = invoice.balanceDue <= 0 ? InvoiceStatus.PAID : InvoiceStatus.PARTIAL;
    return this.invoiceRepo.save(invoice);
  }

  // TIER_3: Aging report
  async getAgingReport(tenantId: number) {
    return this.dataSource.query(
      `SELECT c.client_code, c.client_name,
          SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) <= 0 THEN i.balance_due ELSE 0 END) AS current_amount,
          SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) BETWEEN 1 AND 30 THEN i.balance_due ELSE 0 END) AS days_1_30,
          SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) BETWEEN 31 AND 60 THEN i.balance_due ELSE 0 END) AS days_31_60,
          SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) BETWEEN 61 AND 90 THEN i.balance_due ELSE 0 END) AS days_61_90,
          SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) > 90 THEN i.balance_due ELSE 0 END) AS over_90_days,
          SUM(i.balance_due) AS total_outstanding
        FROM invoices i
        JOIN clients c ON c.id = i.client_id AND c.tenant_id = i.tenant_id
        WHERE i.tenant_id = ? AND i.balance_due > 0 AND i.status NOT IN ('void', 'draft')
        GROUP BY c.id, c.client_code, c.client_name
        ORDER BY total_outstanding DESC`,
      [tenantId],
    );
  }

  async duplicate(tenantId: number, id: number, userId: number): Promise<Invoice> {
    const original = await this.findOne(tenantId, id);
    const dto: CreateInvoiceDto = {
      clientId: original.clientId,
      invoiceDate: new Date(),
      paymentTermsId: original.paymentTermsId,
      notes: original.notes,
      discountAmount: Number(original.discountAmount),
      items: (original as any).items.map((item: InvoiceItem) => ({
        productId: item.productId, quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice), discountPercentage: Number(item.discountPercentage),
        taxPercentage: Number(item.taxPercentage),
      })),
    };
    return this.create(tenantId, dto, userId);
  }
}
