import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsArray, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { InventoryService } from './inventory.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantId, CurrentUser } from '../../common/decorators/tenant.decorator';

class BulkSyncItemDto {
  @IsString() productId: string;
  @IsNumber() newQty: number;
  @IsOptional() @IsString() reason?: string;
}

class BulkSyncDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkSyncItemDto)
  items: BulkSyncItemDto[];
}

@ApiTags('inventory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('stock-summary')
  getStockSummary(@TenantId() tenantId: string) {
    return this.inventoryService.getStockSummary(tenantId);
  }

  // TIER_3: Bulk sync
  @Post('bulk-sync')
  bulkSync(
    @TenantId() tenantId: string,
    @CurrentUser() user: any,
    @Body() body: BulkSyncDto,
  ) {
    return this.inventoryService.bulkSync(tenantId, body.items, user.userId);
  }
}
