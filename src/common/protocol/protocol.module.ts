import { forwardRef, Global, Module } from "@nestjs/common";
import { CachingModule } from "../caching/caching.module";
import { ElasticModule } from "../elastic/elastic.module";
import { GatewayModule } from "../gateway/gateway.module";
import { ProtocolService } from "./protocol.service";

@Global()
@Module({
  imports: [
    GatewayModule,
    forwardRef(() => CachingModule),
    ElasticModule,
  ],
  providers: [
    ProtocolService,
  ],
  exports: [
    ProtocolService,
  ],
})
export class ProtocolModule { }
