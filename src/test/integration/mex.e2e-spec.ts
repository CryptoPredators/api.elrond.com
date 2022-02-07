import Initializer from "./e2e-init";
import { Test } from "@nestjs/testing";
import { PublicAppModule } from "../../public.app.module";
import { Constants } from "../../utils/constants";
import { MexService } from "../../endpoints/mex/mex.service";
import userAccount from "../data/accounts/user.account";
import { MexWeek } from "src/endpoints/mex/entities/mex.week";

describe('Mex Service', () => {
  let mexService: MexService;

  beforeAll(async () => {
    await Initializer.initialize();

    const moduleRef = await Test.createTestingModule({
      imports: [PublicAppModule],
    }).compile();

    mexService = moduleRef.get<MexService>(MexService);

  }, Constants.oneDay() * 1000);


  describe('Get Mex For Address', () => {
    it(`should return total mex amount for address' `, async () => {
      const mexWeeks = await mexService.getMexForAddress(userAccount.address);

      for (const mexWeek of mexWeeks) {
        expect(mexWeek).toHaveStructure(Object.keys(new MexWeek()));
      }
    });
  });

  describe('Get Mex For Address Raw', () => {
    it(`should return total mex amount for address raw'`, async () => {
      const mexWeeks = await mexService.getMexForAddressRaw(userAccount.address);

      for (const mexWeek of mexWeeks) {
        expect(mexWeek).toHaveStructure(Object.keys(new MexWeek()));
      }
    });
  });
});