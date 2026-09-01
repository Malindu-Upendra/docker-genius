import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SemanticLoggerMiddleware } from './middleware/semantic-logger.middleware';
import { SemanticRequestLog } from './entities/semantic-request-log.entity';
import { TenantsModule } from './modules/tenants/tenants.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProductsModule } from './modules/products/products.module';
import { ClientsModule } from './modules/clients/clients.module';
import { GrnModule } from './modules/grn/grn.module';
import { GrunModule } from './modules/grun/grun.module';
import { InvoicingModule } from './modules/invoicing/invoicing.module';
import { PosModule } from './modules/pos/pos.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ReportsModule } from './modules/reports/reports.module';
import { InventoryModule } from './modules/inventory/inventory.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mysql',
        host: config.get<string>('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 3306),
        username: config.get<string>('DB_USERNAME', 'root'),
        password: config.get<string>('DB_PASSWORD', ''),
        database: config.get<string>('DB_DATABASE', 'demo_nexcore'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: false,
        logging: config.get('NODE_ENV') === 'development',
        charset: 'utf8mb4',
        // mysql2's default connectionLimit (10) with no queueLimit means an
        // exhausted pool queues new queries FOREVER with no timeout — under
        // concurrent Tier-1 + Tier-3 load this manifested as
        // /api/auth/login hanging indefinitely rather than failing fast.
        // At N_TIER1=8 + N_TIER3=6 (current load-test defaults), combined
        // with the semantic-logger's insert-per-request, transient demand
        // still exceeded the first-pass 20/50 ceiling ("Queue limit
        // reached" errors observed during telemetry capture) — raised
        // further so real evaluation runs aren't contaminated by pool
        // exhaustion showing up as SLA breaches that have nothing to do
        // with the governor's actual CPU/memory allocation.
        extra: {
          connectionLimit: 40,
          queueLimit: 150,
        },
      }),
    }),
    TypeOrmModule.forFeature([SemanticRequestLog]),
    TenantsModule,
    AuthModule,
    ProductsModule,
    ClientsModule,
    GrnModule,
    GrunModule,
    InvoicingModule,
    PosModule,
    PaymentsModule,
    ReportsModule,
    InventoryModule,
  ],
  providers: [SemanticLoggerMiddleware],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(SemanticLoggerMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
