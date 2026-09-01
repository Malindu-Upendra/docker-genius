import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { CreateProductDto, StockAdjustmentDto } from './dto/create-product.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantId, CurrentUser } from '../../common/decorators/tenant.decorator';

@ApiTags('products')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  create(@TenantId() tenantId: number, @CurrentUser() user: any, @Body() dto: CreateProductDto) {
    return this.productsService.create(tenantId, dto, user.userId);
  }

  @Get()
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findAll(
    @TenantId() tenantId: number,
    @Query('search') search?: string,
    @Query('categoryId') categoryId?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.productsService.findAll(tenantId, search, categoryId ? +categoryId : undefined, page, limit);
  }

  @Get('dashboard')
  getDashboard(@TenantId() tenantId: number) {
    return this.productsService.getDashboardMetrics(tenantId);
  }

  @Get('low-stock')
  getLowStock(@TenantId() tenantId: number) {
    return this.productsService.getLowStockProducts(tenantId);
  }

  @Get('barcode/:barcode')
  findByBarcode(@TenantId() tenantId: number, @Param('barcode') barcode: string) {
    return this.productsService.findByBarcode(tenantId, barcode);
  }

  @Get(':id')
  findOne(@TenantId() tenantId: number, @Param('id', ParseIntPipe) id: number) {
    return this.productsService.findOne(tenantId, id);
  }

  @Put(':id')
  update(@TenantId() tenantId: number, @CurrentUser() user: any, @Param('id', ParseIntPipe) id: number, @Body() dto: Partial<CreateProductDto>) {
    return this.productsService.update(tenantId, id, dto, user.userId);
  }

  @Delete(':id')
  delete(@TenantId() tenantId: number, @CurrentUser() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.productsService.delete(tenantId, id, user.userId);
  }

  @Get(':id/stock')
  getStock(@TenantId() tenantId: number, @Param('id', ParseIntPipe) id: number) {
    return this.productsService.getStock(tenantId, id);
  }

  @Get(':id/availability')
  getAvailability(@TenantId() tenantId: number, @Param('id', ParseIntPipe) id: number) {
    return this.productsService.getAvailability(tenantId, id);
  }

  @Post('stock/adjust')
  adjustStock(@TenantId() tenantId: number, @CurrentUser() user: any, @Body() dto: StockAdjustmentDto) {
    return this.productsService.adjustStock(tenantId, dto, user.userId);
  }

  @Get(':id/audit')
  getAudit(
    @TenantId() tenantId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.productsService.getAuditLog(tenantId, id, page, limit);
  }

  // Categories
  @Post('categories')
  createCategory(@TenantId() tenantId: number, @Body() dto: any) {
    return this.productsService.createCategory(tenantId, dto);
  }

  @Get('categories/list')
  getCategories(@TenantId() tenantId: number) {
    return this.productsService.getCategories(tenantId);
  }

  // Brands
  @Post('brands')
  createBrand(@TenantId() tenantId: number, @Body() dto: any) {
    return this.productsService.createBrand(tenantId, dto);
  }

  @Get('brands/list')
  getBrands(@TenantId() tenantId: number) {
    return this.productsService.getBrands(tenantId);
  }

  // Units
  @Post('units')
  createUnit(@TenantId() tenantId: number, @Body() dto: any) {
    return this.productsService.createUnit(tenantId, dto);
  }

  @Get('units/list')
  getUnits(@TenantId() tenantId: number) {
    return this.productsService.getUnits(tenantId);
  }
}
