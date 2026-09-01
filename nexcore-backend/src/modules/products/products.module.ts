import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from './entities/product.entity';
import { ProductStock } from './entities/product-stock.entity';
import { ProductCategory } from './entities/product-category.entity';
import { ProductBrand } from './entities/product-brand.entity';
import { ProductUnit } from './entities/product-unit.entity';
import { ProductPrice } from './entities/product-price.entity';
import { ProductAuditLog } from './entities/product-audit.entity';
import { StockAdjustment } from './entities/stock-adjustment.entity';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Product, ProductStock, ProductCategory, ProductBrand,
      ProductUnit, ProductPrice, ProductAuditLog, StockAdjustment,
    ]),
  ],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService, TypeOrmModule],
})
export class ProductsModule {}
