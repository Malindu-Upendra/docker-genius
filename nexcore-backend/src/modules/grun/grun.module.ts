import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GrunHeader } from './entities/grun-header.entity';
import { GrunItem } from './entities/grun-item.entity';
import { GrunController } from './grun.controller';
import { GrunService } from './grun.service';

@Module({
  imports: [TypeOrmModule.forFeature([GrunHeader, GrunItem])],
  controllers: [GrunController],
  providers: [GrunService],
  exports: [GrunService, TypeOrmModule],
})
export class GrunModule {}
