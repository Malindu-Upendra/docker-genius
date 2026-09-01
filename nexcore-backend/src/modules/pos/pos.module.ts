import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PosSession } from './entities/pos-session.entity';
import { PosTransaction } from './entities/pos-transaction.entity';
import { PosTransactionItem } from './entities/pos-transaction-item.entity';
import { PosPayment } from './entities/pos-payment.entity';
import { Invoice } from '../invoicing/entities/invoice.entity';
import { InvoiceItem } from '../invoicing/entities/invoice-item.entity';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';

@Module({
  imports: [TypeOrmModule.forFeature([PosSession, PosTransaction, PosTransactionItem, PosPayment, Invoice, InvoiceItem])],
  controllers: [PosController],
  providers: [PosService],
  exports: [PosService, TypeOrmModule],
})
export class PosModule {}
