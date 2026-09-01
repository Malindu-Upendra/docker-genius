import { Injectable, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';

interface SyncItem {
  productId: string;
  newQty: number;
  reason?: string;
}

@Injectable()
export class InventoryService {
  constructor(private readonly dataSource: DataSource) {}

  // TIER_3: Bulk stock sync — deliberately sequential, not bulk UPDATE
  async bulkSync(tenantId: string, items: SyncItem[], userId: string) {
    const results: any[] = [];

    for (const item of items) {
      try {
        const [stock] = await this.dataSource.query(
          'SELECT qty_on_hand FROM product_stocks WHERE product_id = ? AND tenant_id = ?',
          [item.productId, tenantId],
        );

        if (!stock) {
          results.push({ productId: item.productId, status: 'not_found' });
          continue;
        }

        const diff = item.newQty - Number(stock.qty_on_hand);

        await this.dataSource.query(
          'UPDATE product_stocks SET qty_on_hand = ? WHERE product_id = ? AND tenant_id = ?',
          [item.newQty, item.productId, tenantId],
        );

        await this.dataSource.query(
          `INSERT INTO stock_adjustments (id, tenant_id, product_id, adjustment_type, quantity, reason, adjusted_by, created_at)
           VALUES (UUID(), ?, ?, 'recount', ?, ?, ?, NOW())`,
          [tenantId, item.productId, Math.abs(diff), item.reason ?? 'Bulk sync', userId],
        );

        results.push({ productId: item.productId, status: 'synced', previousQty: stock.qty_on_hand, newQty: item.newQty });
      } catch (err) {
        results.push({ productId: item.productId, status: 'error', error: (err as any).message });
      }
    }

    return { processedAt: new Date(), totalItems: items.length, results };
  }

  async getStockSummary(tenantId: string) {
    return this.dataSource.query(
      `SELECT p.product_code, p.product_name, ps.qty_on_hand, ps.qty_reserved,
          (ps.qty_on_hand - ps.qty_reserved) AS available_qty,
          p.reorder_level,
          CASE WHEN (ps.qty_on_hand - ps.qty_reserved) <= p.reorder_level THEN 1 ELSE 0 END AS is_low_stock
        FROM products p
        JOIN product_stocks ps ON ps.product_id = p.id AND ps.tenant_id = p.tenant_id
        WHERE p.tenant_id = ? AND p.is_active = 1 AND p.is_tracked = 1
        ORDER BY is_low_stock DESC, available_qty ASC`,
      [tenantId],
    );
  }
}
