import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Product } from './entities/product.entity';
import { ProductStock } from './entities/product-stock.entity';
import { ProductCategory } from './entities/product-category.entity';
import { ProductBrand } from './entities/product-brand.entity';
import { ProductUnit } from './entities/product-unit.entity';
import { ProductAuditLog } from './entities/product-audit.entity';
import { StockAdjustment, AdjustmentType } from './entities/stock-adjustment.entity';
import { CreateProductDto, StockAdjustmentDto } from './dto/create-product.dto';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    @InjectRepository(ProductStock) private readonly stockRepo: Repository<ProductStock>,
    @InjectRepository(ProductCategory) private readonly categoryRepo: Repository<ProductCategory>,
    @InjectRepository(ProductBrand) private readonly brandRepo: Repository<ProductBrand>,
    @InjectRepository(ProductUnit) private readonly unitRepo: Repository<ProductUnit>,
    @InjectRepository(ProductAuditLog) private readonly auditRepo: Repository<ProductAuditLog>,
    @InjectRepository(StockAdjustment) private readonly adjustmentRepo: Repository<StockAdjustment>,
    private readonly dataSource: DataSource,
  ) {}

  async create(tenantId: number, dto: CreateProductDto, userId: number): Promise<Product> {
    const existing = await this.productRepo.findOne({ where: { tenantId, productCode: dto.productCode } });
    if (existing) throw new ConflictException(`Product code ${dto.productCode} already exists`);

    return this.dataSource.transaction(async (manager) => {
      const product = manager.create(Product, { ...dto, tenantId });
      const saved = await manager.save(product);

      // Initialize stock record
      await manager.save(ProductStock, { tenantId, productId: saved.id, qtyOnHand: 0 });

      await manager.save(ProductAuditLog, {
        tenantId, productId: saved.id, action: 'CREATE', changedBy: userId, newValues: dto as any,
      });

      return saved;
    });
  }

  async findAll(tenantId: number, search?: string, categoryId?: number, page = 1, limit = 20) {
    const qb = this.productRepo.createQueryBuilder('p')
      .leftJoinAndMapOne('p.stock', ProductStock, 's', 's.productId = p.id AND s.tenantId = p.tenantId')
      .leftJoinAndMapOne('p.category', ProductCategory, 'c', 'c.id = p.categoryId')
      .leftJoinAndMapOne('p.brand', ProductBrand, 'b', 'b.id = p.brandId')
      .where('p.tenantId = :tenantId', { tenantId })
      .andWhere('p.isActive = 1');

    if (search) {
      qb.andWhere('(p.productName LIKE :search OR p.productCode LIKE :search OR p.barcode LIKE :search)', {
        search: `%${search}%`,
      });
    }
    if (categoryId) qb.andWhere('p.categoryId = :categoryId', { categoryId });

    const [items, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .orderBy('p.productName', 'ASC')
      .getManyAndCount();

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(tenantId: number, id: number): Promise<Product> {
    const product = await this.productRepo.findOne({ where: { id, tenantId } });
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    return product;
  }

  async findByBarcode(tenantId: number, barcode: string): Promise<Product> {
    const product = await this.productRepo.findOne({ where: { tenantId, barcode, isActive: true } });
    if (!product) throw new NotFoundException(`Product with barcode ${barcode} not found`);
    return product;
  }

  async update(tenantId: number, id: number, dto: Partial<CreateProductDto>, userId: number): Promise<Product> {
    const product = await this.findOne(tenantId, id);
    const oldValues = { ...product };
    Object.assign(product, dto);

    await this.auditRepo.save({
      tenantId, productId: id, action: 'UPDATE', changedBy: userId,
      oldValues: oldValues as any, newValues: dto as any,
    });

    return this.productRepo.save(product);
  }

  async delete(tenantId: number, id: number, userId: number): Promise<void> {
    const product = await this.findOne(tenantId, id);
    product.isActive = false;

    await this.auditRepo.save({ tenantId, productId: id, action: 'DELETE', changedBy: userId });
    await this.productRepo.save(product);
  }

  async getStock(tenantId: number, productId: number): Promise<ProductStock> {
    const stock = await this.stockRepo.findOne({ where: { tenantId, productId } });
    if (!stock) throw new NotFoundException('Stock record not found');
    return stock;
  }

  async adjustStock(tenantId: number, dto: StockAdjustmentDto, userId: number): Promise<StockAdjustment> {
    const stock = await this.stockRepo.findOne({ where: { tenantId, productId: dto.productId } });
    if (!stock) throw new NotFoundException('Stock record not found');

    const isIn = [AdjustmentType.MANUAL_IN, AdjustmentType.RETURN].includes(dto.adjustmentType as AdjustmentType);
    const isOut = [AdjustmentType.MANUAL_OUT, AdjustmentType.DAMAGE, AdjustmentType.EXPIRY].includes(dto.adjustmentType as AdjustmentType);

    if (isOut && Number(stock.qtyOnHand) < dto.quantity) {
      throw new BadRequestException('Insufficient stock for adjustment');
    }

    if (isIn) stock.qtyOnHand = Number(stock.qtyOnHand) + dto.quantity;
    else if (isOut) stock.qtyOnHand = Number(stock.qtyOnHand) - dto.quantity;
    else stock.qtyOnHand = dto.quantity; // recount

    await this.stockRepo.save(stock);

    return this.adjustmentRepo.save({ ...dto, tenantId, adjustedBy: userId } as any);
  }

  async getLowStockProducts(tenantId: number) {
    return this.dataSource.query(
      `SELECT p.id, p.product_code, p.product_name, p.reorder_level,
        ps.qty_on_hand, ps.qty_reserved,
        (ps.qty_on_hand - ps.qty_reserved) AS available_qty
       FROM products p
       JOIN product_stocks ps ON ps.product_id = p.id AND ps.tenant_id = p.tenant_id
       WHERE p.tenant_id = ? AND p.is_active = 1 AND p.is_tracked = 1
         AND (ps.qty_on_hand - ps.qty_reserved) <= p.reorder_level
       ORDER BY available_qty ASC`,
      [tenantId],
    );
  }

  async getDashboardMetrics(tenantId: number) {
    const [totalProducts] = await this.dataSource.query(
      'SELECT COUNT(*) AS total FROM products WHERE tenant_id = ? AND is_active = 1', [tenantId]
    );
    const [lowStock] = await this.dataSource.query(
      `SELECT COUNT(*) AS total FROM products p
       JOIN product_stocks ps ON ps.product_id = p.id AND ps.tenant_id = p.tenant_id
       WHERE p.tenant_id = ? AND p.is_active = 1
         AND (ps.qty_on_hand - ps.qty_reserved) <= p.reorder_level`, [tenantId]
    );
    const [stockValue] = await this.dataSource.query(
      `SELECT SUM(p.cost_price * ps.qty_on_hand) AS total_value
       FROM products p JOIN product_stocks ps ON ps.product_id = p.id AND ps.tenant_id = p.tenant_id
       WHERE p.tenant_id = ? AND p.is_active = 1`, [tenantId]
    );
    return { totalProducts: totalProducts.total, lowStockCount: lowStock.total, totalStockValue: stockValue.total_value };
  }

  // Categories
  async createCategory(tenantId: number, dto: { categoryCode: string; categoryName: string; description?: string; parentCategoryId?: number }) {
    return this.categoryRepo.save({ ...dto, tenantId });
  }

  async getCategories(tenantId: number) {
    return this.categoryRepo.find({ where: { tenantId, isActive: true }, order: { categoryName: 'ASC' } });
  }

  // Brands
  async createBrand(tenantId: number, dto: { brandCode: string; brandName: string; description?: string }) {
    return this.brandRepo.save({ ...dto, tenantId });
  }

  async getBrands(tenantId: number) {
    return this.brandRepo.find({ where: { tenantId, isActive: true }, order: { brandName: 'ASC' } });
  }

  // Units
  async createUnit(tenantId: number, dto: { unitCode: string; unitName: string }) {
    return this.unitRepo.save({ ...dto, tenantId });
  }

  async getUnits(tenantId: number) {
    return this.unitRepo.find({ where: { tenantId, isActive: true }, order: { unitName: 'ASC' } });
  }

  async getAvailability(tenantId: number, productId: number) {
    const product = await this.findOne(tenantId, productId);
    const stock = await this.stockRepo.findOne({ where: { tenantId, productId } });

    const grnHistory = await this.dataSource.query(
      `SELECT gh.id AS grn_id, gh.grn_number, gh.received_date, gh.status,
              s.supplier_name, gi.accepted_qty, gi.received_qty, gi.damaged_qty,
              gi.unit_cost, gi.line_total, gi.batch_number, gi.expiry_date
       FROM grn_items gi
       JOIN grn_headers gh ON gh.id = gi.grn_id
       JOIN suppliers s ON s.id = gh.supplier_id AND s.tenant_id = gh.tenant_id
       WHERE gi.tenant_id = ? AND gi.product_id = ?
       ORDER BY gh.received_date DESC
       LIMIT 50`,
      [tenantId, productId],
    );

    const grunHistory = await this.dataSource.query(
      `SELECT gh.id AS grun_id, gh.grun_number, gh.return_date, gh.status,
              s.supplier_name, gi.return_qty, gi.unit_cost, gi.line_total, gi.item_condition
       FROM grun_items gi
       JOIN grun_headers gh ON gh.id = gi.grun_id
       JOIN suppliers s ON s.id = gh.supplier_id AND s.tenant_id = gh.tenant_id
       WHERE gi.tenant_id = ? AND gi.product_id = ?
       ORDER BY gh.return_date DESC
       LIMIT 50`,
      [tenantId, productId],
    );

    const [summary] = await this.dataSource.query(
      `SELECT
         COALESCE(SUM(CASE WHEN gh.status = 'approved' THEN gi.accepted_qty ELSE 0 END), 0) AS total_received,
         COALESCE(SUM(CASE WHEN gh.status = 'approved' THEN gi.damaged_qty ELSE 0 END), 0) AS total_damaged,
         COUNT(DISTINCT CASE WHEN gh.status = 'approved' THEN gh.id END) AS total_grns
       FROM grn_items gi
       JOIN grn_headers gh ON gh.id = gi.grn_id
       WHERE gi.tenant_id = ? AND gi.product_id = ?`,
      [tenantId, productId],
    );

    const [grunSummary] = await this.dataSource.query(
      `SELECT COALESCE(SUM(CASE WHEN gh.status = 'approved' THEN gi.return_qty ELSE 0 END), 0) AS total_returned
       FROM grun_items gi
       JOIN grun_headers gh ON gh.id = gi.grun_id
       WHERE gi.tenant_id = ? AND gi.product_id = ?`,
      [tenantId, productId],
    );

    return {
      product,
      stock: stock ?? { qtyOnHand: 0, qtyReserved: 0, qtyOnOrder: 0 },
      summary: {
        totalReceived: Number(summary.total_received),
        totalDamaged: Number(summary.total_damaged),
        totalReturned: Number(grunSummary.total_returned),
        totalGrns: Number(summary.total_grns),
        available: Number(stock?.qtyOnHand ?? 0) - Number(stock?.qtyReserved ?? 0),
      },
      grnHistory,
      grunHistory,
    };
  }

  async getAuditLog(tenantId: number, productId: number, page = 1, limit = 20) {
    const [items, total] = await this.auditRepo.findAndCount({
      where: { tenantId, productId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total };
  }
}
