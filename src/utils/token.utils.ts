import { ApiUtils } from "./api.utils";
import * as crypto from 'crypto-js';
import { Nft } from "src/endpoints/nfts/entities/nft";
import { NftType } from "src/endpoints/nfts/entities/nft.type";

export class TokenUtils {
  static isEsdt(tokenIdentifier: string) {
    return tokenIdentifier.split('-').length === 2;
  }

  static canBool(string: string) {
    return string.split('-').pop() === 'true';
  }

  static computeNftUri(uri: string, prefix: string) {
    uri = ApiUtils.replaceUri(uri, 'https://ipfs.io/ipfs', prefix);
    uri = ApiUtils.replaceUri(uri, 'https://gateway.ipfs.io/ipfs', prefix);
    uri = ApiUtils.replaceUri(uri, 'https://gateway.pinata.cloud/ipfs', prefix);
    uri = ApiUtils.replaceUri(uri, 'https://dweb.link/ipfs', prefix);
    uri = ApiUtils.replaceUri(uri, 'ipfs:/', prefix);

    return uri;
  }

  static getUrlHash(url: string) {
    return crypto.SHA256(url).toString().slice(0, 8);
  }

  static getThumbnailUrlIdentifier(nftIdentifier: string, fileUrl: string) {
    const collectionIdentifier = nftIdentifier.split('-').slice(0, 2).join('-');
    const urlHash = TokenUtils.getUrlHash(fileUrl);

    return `${collectionIdentifier}-${urlHash}`;
  }

  static needsDefaultMedia(nft: Nft): boolean {
    if (nft.type === NftType.MetaESDT) {
      return false;
    }

    if (nft.media && nft.media.length > 0) {
      return false;
    }

    return true;
  }
}
