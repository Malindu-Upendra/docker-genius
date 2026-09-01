import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { GrunHeader, GrunStatus, GrunType } from './entities/grun-header.entity';
import { GrunItem } from './entities/grun-item.entity';

@Injectable()
export class GrunService {
  constructor(
    @InjectRepository(GrunHeader) private readonly grunRepo: Repository<GrunHeader>,
    @InjectRepository(GrunItem) private readonly itemRepo: Repository<GrunItem>,
    private readonly dataSource: DataSource,
  ) {}

  private async nextGrunNumber(tenantId: number): Promise<string> {
    const [row] = await this.dataSource.query(
      'SELECT COUNT(*)+1 AS seq FROM grun_headers WHERE tenant_id = ?', [tenantId]
    );
    return `GRUN-${new Date().getFullYear()}-${String(row.seq).padStart(5, '0')}`;
  }

  async create(tenantId: number, dto: any, userId: number): Promise<GrunHeader> {
    return this.dataSource.transaction(async (manager) => {
      // Validate return quantities against original GRN
      if (dto.grnId) {
        for (const item of dto.items) {
          if (item.grnItemId) {
            const [alreadyReturned] = await this.dataSource.query(
              `SELECT COALESCE(SUM(gi.return_qty), 0) AS total_returned
               FROM grun_items gi
               JOIN grun_headers gh ON gh.id = gi.grun_id
               WHERE gi.grn_item_id = ? AND gh.status = 'approved'`, [item.grnItemId]
            );
            const [originalQty] = await this.dataSource.query(
              'SELECT qty FROM grn_items WHERE id = ?', [item.grnItemId]
            );
            const available = Number(originalQty?.qty ?? 0) - Number(alreadyReturned.total_returned);
            if (item.returnQty > available) {
              throw new BadRequestException(`Return quantity ${item.returnQty} exceeds available ${available} for item ${item.grnItemId}`);
            }
          }
        }
      }

      const grunNumber = await this.nextGrunNumber(tenantId);
      const totalCost = dto.items.reduce((s: number, i: any) => s + i.returnQty * i.unitCost, 0);
      const totalQuantity = dto.items.reduce((s: number, i: any) => s + i.returnQty, 0);

      const grun = await manager.save(GrunHeader, {
        tenantId, grunNumber, supplierId: dto.supplierId, grnId: dto.grnId ?? null,
        grunType: dto.grnId ? GrunType.FROM_GRN : GrunType.STANDALONE,
        returnDate: dto.returnDate, returnReason: dto.returnReason,
        totalCost, totalQuantity, status: GrunStatus.DRAFT, createdBy: userId,
      });

      for (const item of dto.items) {
        await manager.save(GrunItem, {
          tenantId, grunId: grun.id, grnItemId: item.grnItemId ?? null,
          productId: item.productId, returnQty: item.returnQty,
          unitCost: item.unitCost, lineTotal: item.returnQty * item.unitCost,
          itemCondition: item.itemCondition, notes: item.notes,
        });
      }

      return grun;
    });
  }

  async findAll(tenantId: number, status?: string, page = 1, limit = 20) {
    const qb = this.grunRepo.createQueryBuilder('g').where('g.tenantId = :tenantId', { tenantId });
    if (status) qb.andWhere('g.status = :status', { status });
    const [items, total] = await qb.skip((page - 1) * limit).take(limit).orderBy('g.createdAt', 'DESC').getManyAndCount();
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(tenantId: number, id: number) {
    const grun = await this.grunRepo.findOne({ where: { id, tenantId } });
    if (!grun) throw new NotFoundException(`GRUN ${id} not found`);
    const items = await this.itemRepo.find({ where: { grunId: id, tenantId } });
    const [supplier] = await this.dataSource.query(
      'SELECT supplier_name, supplier_code FROM suppliers WHERE id = ? LIMIT 1', [grun.supplierId],
    );
    return { ...grun, items, supplierName: supplier?.supplier_name ?? '—', supplierCode: supplier?.supplier_code };
  }

  async submit(tenantId: number, id: number): Promise<GrunHeader> {
    const grun = await this.grunRepo.findOne({ where: { id, tenantId } });
    if (!grun) throw new NotFoundException();
    if (grun.status !== GrunStatus.DRAFT) throw new BadRequestException('Only DRAFT GRUNs can be submitted');
    grun.status = GrunStatus.SUBMITTED;
    return this.grunRepo.save(grun);
  }

  // TIER_3: Calls sp_approve_grun which reduces stock one item at a time
  async approve(tenantId: number, id: number, userId: number): Promise<GrunHeader> {
    const grun = await this.grunRepo.findOne({ where: { id, tenantId } });
    if (!grun) throw new NotFoundException();
    if (grun.status !== GrunStatus.SUBMITTED) throw new BadRequestException('Only SUBMITTED GRUNs can be approved');

    await this.dataSource.query('CALL sp_approve_grun(?, ?)', [id, userId]);
    return this.grunRepo.findOne({ where: { id, tenantId } }) as Promise<GrunHeader>;
  }

  async reject(tenantId: number, id: number, userId: number, reason: string): Promise<GrunHeader> {
    const grun = await this.grunRepo.findOne({ where: { id, tenantId } });
    if (!grun) throw new NotFoundException();
    if (grun.status !== GrunStatus.SUBMITTED) throw new BadRequestException('Only SUBMITTED GRUNs can be rejected');
    grun.status = GrunStatus.DRAFT;
    return this.grunRepo.save(grun);
  }

  // TIER_3: Summary report
  async getSummaryReport(tenantId: number, fromDate?: Date, toDate?: Date) {
    const params: any[] = [tenantId];
    let dateFilter = '';
    if (fromDate) { dateFilter += ' AND gh.return_date >= ?'; params.push(fromDate); }
    if (toDate) { dateFilter += ' AND gh.return_date <= ?'; params.push(toDate); }

    return this.dataSource.query(
      `SELECT s.supplier_name, p.product_code, p.product_name,
          COUNT(DISTINCT gh.id) AS total_gruns,
          SUM(gi.return_qty) AS total_returned_qty,
          SUM(gi.line_total) AS total_return_value,
          gi.item_condition,
          COUNT(*) AS return_count
        FROM grun_headers gh
        JOIN grun_items gi ON gi.grun_id = gh.id AND gi.tenant_id = gh.tenant_id
        JOIN suppliers s ON s.id = gh.supplier_id AND s.tenant_id = gh.tenant_id
        JOIN products p ON p.id = gi.product_id AND p.tenant_id = gh.tenant_id
        WHERE gh.tenant_id = ? AND gh.status = 'approved'${dateFilter}
        GROUP BY s.supplier_name, p.id, p.product_code, p.product_name, gi.item_condition
        ORDER BY total_return_value DESC`,
      params,
    );
  }
}
