import { Test } from "@nestjs/testing";
import { KeybaseService } from "../../common/keybase/keybase.service";
import { Keybase } from "../../common/keybase/entities/keybase";
import { KeybaseState } from "src/common/keybase/entities/keybase.state";
import { KeybaseIdentity } from "src/common/keybase/entities/keybase.identity";
import '../../utils/extensions/jest.extensions';
import { PublicAppModule } from "src/public.app.module";

describe('Keybase Service', () => {
  let keybaseService: KeybaseService;

  const identity: string = 'cryptoshigo';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PublicAppModule],
    }).compile();

    keybaseService = moduleRef.get<KeybaseService>(KeybaseService);
  });

  beforeEach(() => { jest.restoreAllMocks(); });

  describe('Confirm Keybase Against Cache', () => {
    it(`should confirm keybase against cache and return Keybase Object`, async () => {
      const keybaseDictionary = await keybaseService.confirmKeybasesAgainstCache();

      const keybases = Object.values(keybaseDictionary);
      expect(keybases.length).toBeGreaterThan(100);

      for (const keybase of keybases) {
        expect(keybase).toHaveStructure(Object.keys(new KeybaseState()));
      }
    });
  });

  describe('Get Identities Profiles Against Cache', () => {
    it(`should return identities profiles`, async () => {
      const profiles = await keybaseService.getIdentitiesProfilesAgainstCache();
      expect(profiles).toBeInstanceOf(Array);

      for (const profile of profiles) {
        expect(profile).toBeInstanceOf(Object);
      }
    });
  });

  describe('Get Cached Identity Profiles Keybases', () => {
    it(`should return cached identities profiles`, async () => {
      const profiles = await keybaseService.getCachedIdentityProfilesKeybases();
      for (const profile of profiles) {
        expect(profile).toBeInstanceOf(Object);
      }
    });
  });

  describe('Get Cached Nodes And Providers Keybases', () => {
    it(`should return cached nodes identities`, async () => {
      const nodesDictionary = await keybaseService.getCachedNodesAndProvidersKeybases();
      if (!nodesDictionary) {
        throw new Error('nodesDictionary it not defined');
      }

      const nodes = Object.values(nodesDictionary);
      expect(nodes.length).toBeGreaterThan(100);

      for (const node of nodes) {
        expect(node).toHaveStructure(Object.keys(new KeybaseState()));
      }
    });
  });

  describe('is Keybase Pub Up', () => {
    it(`verify is keybase is pub up`, async () => {
      const key = await keybaseService.isKeybasePubUp();
      expect(key).toStrictEqual(true);
    });
  });

  describe('is Keybase Io Up', () => {
    it(`verify is keybase is Io up`, async () => {
      const key = await keybaseService.isKeybaseIoUp();
      expect(key).toStrictEqual(true);
    });
  });

  describe('Confirm Keybase', () => {
    it('should confirm Keybase', async () => {
      const keybase = new Keybase();
      keybase.identity = identity;

      const key = await keybaseService.confirmKeybase(keybase);
      expect(key).toStrictEqual(true);
    });
  });

  describe('Get Profile', () => {
    it('should return identity profile', async () => {
      const profile = await keybaseService.getProfile(identity);

      expect(profile).toHaveStructure(Object.keys(new KeybaseIdentity()));
    });
  });
});
