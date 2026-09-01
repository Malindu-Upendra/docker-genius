import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GrnHeader } from './entities/grn-header.entity';
import { GrnItem } from './entities/grn-item.entity';
import { Supplier } from './entities/supplier.entity';
import { GrnController } from './grn.controller';
import { GrnService } from './grn.service';

@Module({
  imports: [TypeOrmModule.forFeature([GrnHeader, GrnItem, Supplier])],
  controllers: [GrnController],
  providers: [GrnService],
  exports: [GrnService, TypeOrmModule],
})
export class GrnModule {}
