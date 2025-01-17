import { forwardRef, Inject, Injectable } from "@nestjs/common";
import { ApiConfigService } from "src/common/api-config/api.config.service";
import { ElasticService } from "src/common/elastic/elastic.service";
import { QueryPagination } from "src/common/entities/query.pagination";
import { GatewayService } from "src/common/gateway/gateway.service";
import { BinaryUtils } from "src/utils/binary.utils";
import { EsdtService } from "../esdt/esdt.service";
import { AddresCollectionRoles } from "./entities/address.collection.roles";
import { CollectionFilter } from "./entities/collection.filter";
import { NftCollection } from "./entities/nft.collection";
import { NftType } from "../nfts/entities/nft.type";
import { TokenAssetService } from "../tokens/token.asset.service";
import { VmQueryService } from "../vm.query/vm.query.service";
import { NftCollectionAccount } from "./entities/nft.collection.account";
import { GatewayComponentRequest } from "src/common/gateway/entities/gateway.component.request";
import { QueryType } from "src/common/elastic/entities/query.type";
import { QueryOperator } from "src/common/elastic/entities/query.operator";
import { ElasticQuery } from "src/common/elastic/entities/elastic.query";
import { QueryConditionOptions } from "src/common/elastic/entities/query.condition.options";
import { ElasticSortOrder } from "src/common/elastic/entities/elastic.sort.order";
import { TokenProperties } from "../tokens/entities/token.properties";
import { CachingService } from "src/common/caching/caching.service";
import { CacheInfo } from "src/common/caching/entities/cache.info";
import { RecordUtils } from "src/utils/record.utils";
import { TokenAssets } from "../tokens/entities/token.assets";
import { EsdtAddressService } from "../esdt/esdt.address.service";
import { EsdtDataSource } from "../esdt/entities/esdt.data.source";

@Injectable()
export class CollectionService {
  constructor(
    private readonly gatewayService: GatewayService,
    private readonly apiConfigService: ApiConfigService,
    private readonly elasticService: ElasticService,
    private readonly esdtService: EsdtService,
    private readonly tokenAssetService: TokenAssetService,
    private readonly vmQueryService: VmQueryService,
    private readonly cachingService: CachingService,
    @Inject(forwardRef(() => EsdtAddressService))
    private readonly esdtAddressService: EsdtAddressService,
  ) { }

  buildCollectionFilter(filter: CollectionFilter, address?: string) {
    const mustNotQueries = [];
    mustNotQueries.push(QueryType.Exists('identifier'));

    const mustQueries = [];
    if (address) {
      mustQueries.push(QueryType.Match("currentOwner", address));
    }

    if (filter.collection !== undefined) {
      mustQueries.push(QueryType.Match('token', filter.collection, QueryOperator.AND));
    }

    if (filter.identifiers !== undefined) {
      mustQueries.push(QueryType.Should(filter.identifiers.map(identifier => QueryType.Match('token', identifier, QueryOperator.AND))));
    }

    if (filter.search !== undefined) {
      mustQueries.push(QueryType.Wildcard('token', `*${filter.search}*`));
    }

    if (filter.type !== undefined) {
      mustQueries.push(QueryType.Match('type', filter.type));
    }

    const shouldQueries = [];
    shouldQueries.push(QueryType.Match('type', NftType.SemiFungibleESDT));
    shouldQueries.push(QueryType.Match('type', NftType.NonFungibleESDT));
    shouldQueries.push(QueryType.Match('type', NftType.MetaESDT));

    const elasticQuery = ElasticQuery.create()
      .withCondition(QueryConditionOptions.must, mustQueries)
      .withCondition(QueryConditionOptions.should, shouldQueries)
      .withCondition(QueryConditionOptions.mustNot, mustNotQueries);

    return elasticQuery;
  }

  async getNftCollections(pagination: QueryPagination, filter: CollectionFilter): Promise<NftCollection[]> {
    if (filter.creator) {
      const creatorResult = await this.gatewayService.get(`address/${filter.creator}/esdts-with-role/ESDTRoleNFTCreate`, GatewayComponentRequest.addressEsdtWithRole);
      if (creatorResult.tokens.length === 0) {
        return [];
      }

      filter.identifiers = creatorResult.tokens;
    }

    const elasticQuery = this.buildCollectionFilter(filter)
      .withPagination(pagination)
      .withSort([{ name: 'timestamp', order: ElasticSortOrder.descending }]);

    const tokenCollections = await this.elasticService.getList('tokens', 'identifier', elasticQuery);
    const collectionsIdentifiers = tokenCollections.map((collection) => collection.token);

    const indexedCollections: Record<string, any> = {};
    for (const collection of tokenCollections) {
      indexedCollections[collection.token] = collection;
    }

    const nftColections: NftCollection[] = await this.applyPropertiesToCollections(collectionsIdentifiers);

    for (const nftCollection of nftColections) {
      const indexedCollection = indexedCollections[nftCollection.collection];
      if (indexedCollection) {
        nftCollection.timestamp = indexedCollection.timestamp;
      }
    }

    return nftColections;
  }

  async applyPropertiesToCollections(collectionsIdentifiers: string[]): Promise<NftCollection[]> {
    const nftCollections: NftCollection[] = [];
    const collectionsProperties = await this.batchGetCollectionsProperties(collectionsIdentifiers);
    const collectionsAssets = await this.batchGetCollectionsAssets(collectionsIdentifiers);

    for (const collectionIdentifier of collectionsIdentifiers) {
      const collectionProperties = collectionsProperties[collectionIdentifier];
      if (!collectionProperties) {
        continue;
      }

      const nftCollection = new NftCollection();

      // @ts-ignore
      nftCollection.type = collectionProperties.type;
      nftCollection.name = collectionProperties.name;
      nftCollection.collection = collectionIdentifier.split('-').slice(0, 2).join('-');
      nftCollection.ticker = collectionIdentifier.split('-')[0];
      nftCollection.canFreeze = collectionProperties.canFreeze;
      nftCollection.canWipe = collectionProperties.canWipe;
      nftCollection.canPause = collectionProperties.canPause;
      nftCollection.canTransferRole = collectionProperties.canTransferNFTCreateRole;
      nftCollection.owner = collectionProperties.owner;

      if (nftCollection.type === NftType.MetaESDT) {
        nftCollection.decimals = collectionProperties.decimals;
      }

      nftCollection.assets = collectionsAssets[collectionIdentifier];
      nftCollection.ticker = nftCollection.assets ? collectionIdentifier.split('-')[0] : nftCollection.collection;

      nftCollections.push(nftCollection);
    }

    return nftCollections;
  }

  async batchGetCollectionsProperties(collectionsIdentifiers: string[]): Promise<{ [key: string]: TokenProperties | undefined }> {
    const collectionsProperties: { [key: string]: TokenProperties | undefined } = {};
    await this.cachingService.batchApply(
      collectionsIdentifiers,
      collectionIdentifier => CacheInfo.EsdtProperties(collectionIdentifier).key,
      async collectionsIdentifiers => {
        const result: { [key: string]: TokenProperties | undefined } = {};

        for (const collectionIdentifier of collectionsIdentifiers) {
          const collectionProperties = await this.esdtService.getEsdtTokenProperties(collectionIdentifier);
          result[collectionIdentifier] = collectionProperties;
        }

        return RecordUtils.mapKeys(result, identifier => CacheInfo.EsdtProperties(identifier).key);
      },
      (collectionIdentifier, properties) => collectionsProperties[collectionIdentifier] = properties,
      CacheInfo.EsdtProperties('').ttl
    );

    return collectionsProperties;
  }

  async batchGetCollectionsAssets(collectionsIdentifiers: string[]): Promise<{ [key: string]: TokenAssets | undefined }> {
    const collectionsAssets: { [key: string]: TokenAssets | undefined } = {};

    await this.cachingService.batchApply(
      collectionsIdentifiers,
      collectionIdentifier => CacheInfo.EsdtAssets(collectionIdentifier).key,
      async collectionsIdentifiers => {
        const result: { [key: string]: TokenAssets | undefined } = {};

        for (const collectionIdentifier of collectionsIdentifiers) {
          const collectionAssets = await this.tokenAssetService.getAssets(collectionIdentifier);
          result[collectionIdentifier] = collectionAssets;
        }

        return RecordUtils.mapKeys(result, identifier => CacheInfo.EsdtAssets(identifier).key);
      },
      (collectionIdentifier, properties) => collectionsAssets[collectionIdentifier] = properties,
      CacheInfo.EsdtAssets('').ttl
    );

    return collectionsAssets;
  }


  async getNftCollectionCount(filter: CollectionFilter): Promise<number> {
    if (filter.creator) {
      const creatorResult = await this.gatewayService.get(`address/${filter.creator}/esdts-with-role/ESDTRoleNFTCreate`, GatewayComponentRequest.addressEsdtWithRole);
      return creatorResult.tokens.length;
    }

    const elasticQuery = this.buildCollectionFilter(filter);

    return await this.elasticService.getCount('tokens', elasticQuery);
  }

  async getNftCollection(collection: string): Promise<NftCollection | undefined> {
    const result = await this.getNftCollections({ from: 0, size: 1 }, { collection });
    if (result.length === 0 || result[0].collection.toLowerCase() !== collection.toLowerCase()) {
      return undefined;
    }

    const nftCollection = result[0];

    await this.applySpecialRoles(nftCollection);

    return nftCollection;
  }

  private async applySpecialRoles(nftCollection: NftCollection) {
    const collectionRolesEncoded = await this.vmQueryService.vmQuery(
      this.apiConfigService.getEsdtContractAddress(),
      'getSpecialRoles',
      undefined,
      [BinaryUtils.stringToHex(nftCollection.collection)]
    );

    if (!collectionRolesEncoded) {
      return;
    }

    for (const rolesForAddressEncoded of collectionRolesEncoded) {
      const rolesForAddressDecoded = BinaryUtils.base64Decode(rolesForAddressEncoded);
      const components = rolesForAddressDecoded.split(':');

      const roleForAddress = new AddresCollectionRoles();
      roleForAddress.address = components[0];
      roleForAddress.roles = components[1].split(',');

      nftCollection.roles.push(roleForAddress);
    }
  }

  async getCollectionForAddress(address: string, collection: string): Promise<NftCollectionAccount | undefined> {
    const filter: CollectionFilter = { collection };

    const collections = await this.esdtAddressService.getCollectionsForAddress(address, filter, { from: 0, size: 1 });
    if (collections.length === 0) {
      return undefined;
    }

    return collections[0];
  }

  async getCollectionsForAddress(address: string, filter: CollectionFilter, pagination: QueryPagination, source?: EsdtDataSource): Promise<NftCollectionAccount[]> {
    const collections = await this.esdtAddressService.getCollectionsForAddress(address, filter, pagination, source);

    return collections;
  }

  async getCollectionCountForAddress(address: string, filter: CollectionFilter): Promise<number> {
    const count = await this.esdtAddressService.getCollectionCountForAddressFromElastic(address, filter);

    return count;
  }
}
