import { forwardRef, Module } from "@nestjs/common";
import { NodeModule } from "src/endpoints/nodes/node.module";
import { ProviderModule } from "src/endpoints/providers/provider.module";
import { KeybaseService } from "./keybase.service";

@Module({
  imports: [
    forwardRef(() => NodeModule),
    forwardRef(() => ProviderModule),
  ],
  providers: [
    KeybaseService,
  ],
  exports: [
    KeybaseService,
  ],
})
export class KeybaseModule { }
