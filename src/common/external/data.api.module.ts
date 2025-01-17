import { forwardRef } from "@nestjs/common";
import { Global, Module } from "@nestjs/common";
import { ApiConfigModule } from "../api-config/api.config.module";
import { ApiModule } from "../network/api.module";
import { DataApiService } from "./data.api.service";

@Global()
@Module({
  imports: [
    ApiConfigModule,
    forwardRef(() => ApiModule),
  ],
  providers: [
    DataApiService,
  ],
  exports: [
    DataApiService,
  ],
})
export class DataApiModule { }
