import { IsString, IsOptional, IsNumber, IsBoolean, IsEnum, Min, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductType } from '../entities/product.entity';

export class CreateProductDto {
  @ApiProperty({ example: 'PRD001' })
  @IsString()
  @Length(1, 50)
  productCode: string;

  @ApiProperty({ example: 'Premium Rice 1kg' })
  @IsString()
  @Length(1, 200)
  productName: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  categoryId?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  brandId?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  unitId?: number;

  @ApiPropertyOptional({ enum: ProductType, default: ProductType.SIMPLE })
  @IsEnum(ProductType)
  @IsOptional()
  productType?: ProductType;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  barcode?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  costPrice?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  sellingPrice?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  taxPercentage?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  reorderLevel?: number;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  isTracked?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  hasSerial?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  hasBatch?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  hasExpiry?: boolean;
}

export class StockAdjustmentDto {
  @ApiProperty()
  @IsNumber()
  productId: number;

  @ApiProperty({ enum: ['manual_in', 'manual_out', 'damage', 'expiry', 'recount', 'return'] })
  @IsString()
  adjustmentType: string;

  @ApiProperty()
  @IsNumber()
  quantity: number;

  @ApiProperty()
  @IsString()
  reason: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  referenceNumber?: string;
}
