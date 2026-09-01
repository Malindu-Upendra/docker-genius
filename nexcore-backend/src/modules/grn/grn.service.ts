import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { GrnHeader, GrnStatus } from './entities/grn-header.entity';
import { GrnItem } from './entities/grn-item.entity';
import { Supplier } from './entities/supplier.entity';

interface CreateGrnDto {
  supplierId: number;
  referenceNumber?: string;
  receivedDate: Date;
  notes?: string;
  items: {
    productId: number;
    qty: number;
    unitCost: number;
    batchNumber?: string;
    expiryDate?: Date;
  }[];
}

@Injectable()
export class GrnService {
  constructor(
    @InjectRepository(GrnHeader) private readonly grnRepo: Repository<GrnHeader>,
    @InjectRepository(GrnItem) private readonly itemRepo: Repository<GrnItem>,
    @InjectRepository(Supplier) private readonly supplierRepo: Repository<Supplier>,
    private readonly dataSource: DataSource,
  ) {}

  private async nextGrnNumber(tenantId: number): Promise<string> {
    const [row] = await this.dataSource.query(
      'SELECT COUNT(*)+1 AS seq FROM grn_headers WHERE tenant_id = ?', [tenantId]
    );
    return `GRN-${new Date().getFullYear()}-${String(row.seq).padStart(5, '0')}`;
  }

  async create(tenantId: number, dto: CreateGrnDto, userId: number): Promise<GrnHeader> {
    return this.dataSource.transaction(async (manager) => {
      const grnNumber = await this.nextGrnNumber(tenantId);
      const totalCost = dto.items.reduce((sum, i) => sum + i.qty * i.unitCost, 0);
      const totalQuantity = dto.items.reduce((sum, i) => sum + i.qty, 0);

      const grn = await manager.save(GrnHeader, {
        tenantId, grnNumber, supplierId: dto.supplierId,
        referenceNumber: dto.referenceNumber, receivedDate: dto.receivedDate,
        notes: dto.notes, totalCost, totalQuantity, status: GrnStatus.DRAFT, createdBy: userId,
      });

      for (const item of dto.items) {
        await manager.save(GrnItem, {
          tenantId, grnId: grn.id,
          productId: item.productId,
          qty: item.qty,
          unitCost: item.unitCost,
          lineTotal: item.qty * item.unitCost,
          batchNumber: item.batchNumber,
          expiryDate: item.expiryDate,
        });
      }

      return grn;
    });
  }

  async findAll(tenantId: number, status?: string, supplierId?: number, page = 1, limit = 20) {
    const qb = this.grnRepo.createQueryBuilder('g')
      .where('g.tenantId = :tenantId', { tenantId });

    if (status) qb.andWhere('g.status = :status', { status });
    if (supplierId) qb.andWhere('g.supplierId = :supplierId', { supplierId });

    const [items, total] = await qb
      .skip((page - 1) * limit).take(limit)
      .orderBy('g.createdAt', 'DESC')
      .getManyAndCount();

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(tenantId: number, id: number) {
    const grn = await this.grnRepo.findOne({ where: { id, tenantId } });
    if (!grn) throw new NotFoundException(`GRN ${id} not found`);
    const items = await this.itemRepo.find({ where: { grnId: id, tenantId } });

    // Fetch total returned qty per grn_item from approved GRUNs
    const itemIds = items.map(i => i.id);
    let returnedMap: Record<number, number> = {};
    if (itemIds.length > 0) {
      const placeholders = itemIds.map(() => '?').join(',');
      const rows: { grn_item_id: number; returned_qty: number }[] = await this.dataSource.query(
        `SELECT gi.grn_item_id, SUM(gi.return_qty) AS returned_qty
         FROM grun_items gi
         JOIN grun_headers gh ON gh.id = gi.grun_id
         WHERE gi.grn_item_id IN (${placeholders}) AND gh.status = 'approved'
         GROUP BY gi.grn_item_id`,
        itemIds,
      );
      for (const r of rows) returnedMap[r.grn_item_id] = Number(r.returned_qty);
    }

    const enrichedItems = items.map(item => ({
      ...item,
      returnedQty: returnedMap[item.id] ?? 0,
      netQty: Number(item.qty) - (returnedMap[item.id] ?? 0),
    }));

    const [supplier] = await this.dataSource.query(
      'SELECT supplier_name, supplier_code FROM suppliers WHERE id = ? LIMIT 1', [grn.supplierId],
    );
    return { ...grn, items: enrichedItems, supplierName: supplier?.supplier_name ?? '—', supplierCode: supplier?.supplier_code };
  }

  async submit(tenantId: number, id: number): Promise<GrnHeader> {
    const grn = await this.grnRepo.findOne({ where: { id, tenantId } });
    if (!grn) throw new NotFoundException(`GRN ${id} not found`);
    if (grn.status !== GrnStatus.DRAFT) throw new BadRequestException('Only DRAFT GRNs can be submitted');
    grn.status = GrnStatus.SUBMITTED;
    return this.grnRepo.save(grn);
  }

  // TIER_3: Sequential stock update via stored procedure — deliberately unoptimized
  async approve(tenantId: number, id: number, userId: number): Promise<GrnHeader> {
    const grn = await this.grnRepo.findOne({ where: { id, tenantId } });
    if (!grn) throw new NotFoundException(`GRN ${id} not found`);
    if (grn.status !== GrnStatus.SUBMITTED) throw new BadRequestException('Only SUBMITTED GRNs can be approved');

    // Call stored procedure — TIER_3 operation that updates stock one item at a time
    await this.dataSource.query('CALL sp_approve_grn(?, ?)', [id, userId]);

    return this.grnRepo.findOne({ where: { id, tenantId } }) as Promise<GrnHeader>;
  }

  async reject(tenantId: number, id: number, userId: number, reason: string): Promise<GrnHeader> {
    const grn = await this.grnRepo.findOne({ where: { id, tenantId } });
    if (!grn) throw new NotFoundException(`GRN ${id} not found`);
    if (grn.status !== GrnStatus.SUBMITTED) throw new BadRequestException('Only SUBMITTED GRNs can be rejected');

    grn.status = GrnStatus.REJECTED;
    grn.rejectedBy = userId;
    grn.rejectedAt = new Date();
    grn.rejectionReason = reason;
    return this.grnRepo.save(grn);
  }

  // TIER_3: Bulk process multiple GRNs — sequential, deliberately heavy
  async bulkProcess(tenantId: number, grnIds: number[], userId: number) {
    const results: any[] = [];
    for (const id of grnIds) {
      try {
        const result = await this.approve(tenantId, id, userId);
        results.push({ id, status: 'approved', grnNumber: result.grnNumber });
      } catch (e) {
        results.push({ id, status: 'failed', error: (e as any).message });
      }
    }
    return results;
  }

  // TIER_3: Supplier performance report
  async getSupplierPerformance(tenantId: number, supplierId?: number, fromDate?: Date, toDate?: Date) {
    const params: any[] = [tenantId];
    let whereExtra = '';
    if (supplierId) { whereExtra += ' AND g.supplier_id = ?'; params.push(supplierId); }
    if (fromDate) { whereExtra += ' AND g.received_date >= ?'; params.push(fromDate); }
    if (toDate) { whereExtra += ' AND g.received_date <= ?'; params.push(toDate); }

    return this.dataSource.query(
      `SELECT s.supplier_code, s.supplier_name,
          COUNT(g.id) AS total_grns,
          SUM(CASE WHEN g.status = 'approved' THEN 1 ELSE 0 END) AS approved_grns,
          SUM(CASE WHEN g.status = 'rejected' THEN 1 ELSE 0 END) AS rejected_grns,
          SUM(gi.qty) AS total_received,
          SUM(g.total_cost) AS total_purchase_value
        FROM suppliers s
        LEFT JOIN grn_headers g ON g.supplier_id = s.id AND g.tenant_id = s.tenant_id${whereExtra}
        LEFT JOIN grn_items gi ON gi.grn_id = g.id AND gi.tenant_id = g.tenant_id
        WHERE s.tenant_id = ?
        GROUP BY s.id, s.supplier_code, s.supplier_name
        ORDER BY total_purchase_value DESC`,
      [...params, tenantId],
    );
  }

  // Suppliers
  async createSupplier(tenantId: number, dto: any): Promise<Supplier> {
    return this.supplierRepo.save({ ...dto, tenantId });
  }

  async getSuppliers(tenantId: number) {
    return this.supplierRepo.find({ where: { tenantId, isActive: true }, order: { supplierName: 'ASC' } });
  }

  async findSupplier(tenantId: number, id: number): Promise<Supplier> {
    const s = await this.supplierRepo.findOne({ where: { id, tenantId } });
    if (!s) throw new NotFoundException(`Supplier ${id} not found`);
    return s;
  }
}
