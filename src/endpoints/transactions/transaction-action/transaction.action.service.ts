import { Injectable, Logger } from "@nestjs/common";
import { Transaction } from "src/endpoints/transactions/entities/transaction";
import { AddressUtils } from "src/utils/address.utils";
import { BinaryUtils } from "src/utils/binary.utils";
import { TransactionMetadata } from "./entities/transaction.metadata";
import { TransactionAction } from "./entities/transaction.action";
import { TransactionActionMexRecognizerService } from "./recognizers/mex/transaction.action.mex.recognizer.service";
import { TransactionActionRecognizerInterface } from "./transaction.action.recognizer.interface";
import { StakeActionRecognizerService } from "./recognizers/staking/transaction.action.stake.recognizer.service";
import { SCCallActionRecognizerService } from "./recognizers/sc-calls/transaction.action.sc-calls.recognizer.service";
import { TransactionActionEsdtNftRecognizerService } from "./recognizers/esdt/transaction.action.esdt.nft.recognizer.service";
import { TokenTransferService } from "src/endpoints/tokens/token.transfer.service";
import { StringUtils } from "src/utils/string.utils";
import { TransactionType } from "src/endpoints/transactions/entities/transaction.type";

@Injectable()
export class TransactionActionService {
  private recognizers: TransactionActionRecognizerInterface[] = [];
  private readonly logger: Logger;

  constructor(
    private readonly mexRecognizer: TransactionActionMexRecognizerService,
    private readonly esdtNftRecognizer: TransactionActionEsdtNftRecognizerService,
    private readonly stakeRecognizer: StakeActionRecognizerService,
    private readonly scCallRecognizer: SCCallActionRecognizerService,
    private readonly tokenTransferService: TokenTransferService,
  ) {
    this.logger = new Logger(TransactionActionService.name);
  }

  private async getRecognizers() {
    if (this.recognizers.length === 0) {
      const isMexActive = await this.mexRecognizer.isActive();
      if (isMexActive) {
        this.recognizers.push(this.mexRecognizer);
      }

      this.recognizers.push(this.esdtNftRecognizer);
      this.recognizers.push(this.stakeRecognizer);
      this.recognizers.push(this.scCallRecognizer);
    }

    return this.recognizers;
  }

  async getTransactionAction(transaction: Transaction): Promise<TransactionAction | undefined> {
    const metadata = await this.getTransactionMetadata(transaction);

    const recognizers = await this.getRecognizers();

    for (const recognizer of recognizers) {
      const action = await recognizer.recognize(metadata);
      if (action !== undefined) {
        return action;
      }
    }

    return undefined;
  }

  async getTransactionMetadata(transaction: Transaction): Promise<TransactionMetadata> {
    const metadata = this.getNormalTransactionMetadata(transaction);

    const esdtMetadata = await this.getEsdtTransactionMetadata(metadata);
    if (esdtMetadata) {
      return esdtMetadata;
    }

    const nftMetadata = await this.getNftTransferMetadata(metadata);
    if (nftMetadata) {
      return nftMetadata;
    }

    const multiMetadata = await this.getMultiTransferMetadata(metadata);
    if (multiMetadata) {
      return multiMetadata;
    }

    return metadata;
  }

  private getNormalTransactionMetadata(transaction: Transaction): TransactionMetadata {
    const metadata = new TransactionMetadata();
    metadata.sender = transaction.sender;
    metadata.receiver = transaction.receiver;
    metadata.value = BigInt(transaction.value);

    if (transaction.data) {
      const decodedData = BinaryUtils.base64Decode(transaction.data);

      const dataComponents = decodedData.split('@');

      const args = dataComponents.slice(1);
      if (args.all(x => this.isSmartContractArgument(x))) {
        metadata.functionName = dataComponents[0];
        metadata.functionArgs = args;
      }

      if (metadata.functionName === 'relayedTx' && metadata.functionArgs.length === 1) {
        try {
          const relayedTransaction = JSON.parse(BinaryUtils.hexToString(metadata.functionArgs[0]));
          relayedTransaction.value = relayedTransaction.value.toString();
          relayedTransaction.sender = AddressUtils.bech32Encode(BinaryUtils.base64ToHex(relayedTransaction.sender));
          relayedTransaction.receiver = AddressUtils.bech32Encode(BinaryUtils.base64ToHex(relayedTransaction.receiver));
          return this.getNormalTransactionMetadata(relayedTransaction);
        } catch (error) {
          this.logger.error(`Unhandled error when interpreting relayed transaction`);
          this.logger.error(error);
        }
      }

      if (metadata.functionName === 'relayedTxV2' && metadata.functionArgs.length === 4) {
        try {
          const relayedTransaction = new Transaction();
          relayedTransaction.sender = transaction.receiver;
          relayedTransaction.receiver = AddressUtils.bech32Encode(metadata.functionArgs[0]);
          relayedTransaction.data = BinaryUtils.base64Encode(BinaryUtils.hexToString(metadata.functionArgs[2]));
          relayedTransaction.value = '0';

          return this.getNormalTransactionMetadata(relayedTransaction);
        } catch (error) {
          this.logger.error(`Unhandled error when interpreting relayed transaction v2`);
          this.logger.error(error);
        }
      }
    }

    try {
      if (transaction.type === TransactionType.SmartContractResult) {
        if (metadata.functionName === 'MultiESDTNFTTransfer' &&
          metadata.functionArgs.length > 0 &&
          AddressUtils.bech32Encode(metadata.functionArgs[0]) === metadata.receiver
        ) {
          metadata.receiver = metadata.sender;
        }

        if (metadata.functionName === 'ESDTNFTTransfer' &&
          metadata.functionArgs.length > 3 &&
          AddressUtils.bech32Encode(metadata.functionArgs[3]) === metadata.receiver
        ) {
          metadata.receiver = metadata.sender;
        }
      }
    } catch (error) {
      this.logger.error(`Unhandled error when interpreting MultiESDTNFTTransfer / ESDTNFTTransfer for a smart contract result`);
      this.logger.error(error);
    }

    return metadata;
  }

  private isSmartContractArgument(arg: string): boolean {
    if (!StringUtils.isHex(arg)) {
      return false;
    }

    if (arg.length % 2 !== 0) {
      return false;
    }

    return true;
  }

  private async getMultiTransferMetadata(metadata: TransactionMetadata): Promise<TransactionMetadata | undefined> {
    if (metadata.sender !== metadata.receiver) {
      return undefined;
    }

    if (metadata.functionName !== 'MultiESDTNFTTransfer') {
      return undefined;
    }

    const args = metadata.functionArgs;
    if (args.length < 3) {
      return undefined;
    }

    if (!AddressUtils.isAddressValid(args[0])) {
      return undefined;
    }

    const receiver = AddressUtils.bech32Encode(args[0]);
    const transferCount = BinaryUtils.hexToNumber(args[1]);

    const result = new TransactionMetadata();
    if (!result.transfers) {
      result.transfers = [];
    }

    let index = 2;
    for (let i = 0; i < transferCount; i++) {
      const identifier = BinaryUtils.hexToString(args[index++]);
      const nonce = args[index++];
      const value = BinaryUtils.hexToBigInt(args[index++]);

      if (nonce) {
        const properties = await this.tokenTransferService.getTokenTransferProperties(identifier, nonce);
        if (properties) {
          result.transfers.push({
            value,
            properties,
          });
        }
      } else {
        const properties = await this.tokenTransferService.getTokenTransferProperties(identifier);
        if (properties) {
          result.transfers.push({
            value,
            properties,
          });
        }
      }
    }

    result.sender = metadata.sender;
    result.receiver = receiver;

    if (args.length > index) {
      result.functionName = BinaryUtils.hexToString(args[index++]);
      result.functionArgs = args.slice(index++);
    }

    return result;
  }

  private async getNftTransferMetadata(metadata: TransactionMetadata): Promise<TransactionMetadata | undefined> {
    if (metadata.sender !== metadata.receiver) {
      return undefined;
    }

    if (metadata.functionName !== 'ESDTNFTTransfer') {
      return undefined;
    }

    const args = metadata.functionArgs;
    if (args.length < 4) {
      return undefined;
    }

    if (!AddressUtils.isAddressValid(args[3])) {
      return undefined;
    }

    const collectionIdentifier = BinaryUtils.hexToString(args[0]);
    const nonce = args[1];
    const value = BinaryUtils.hexToBigInt(args[2]);
    const receiver = AddressUtils.bech32Encode(args[3]);

    const properties = await this.tokenTransferService.getTokenTransferProperties(collectionIdentifier, nonce);
    if (!properties) {
      return undefined;
    }

    const result = new TransactionMetadata();
    result.sender = metadata.sender;
    result.receiver = receiver;
    result.value = value;

    if (args.length > 4) {
      result.functionName = BinaryUtils.hexToString(args[4]);
      result.functionArgs = args.slice(5);
    }

    result.transfers = [{
      value,
      properties,
    }];

    return result;
  }

  private async getEsdtTransactionMetadata(metadata: TransactionMetadata): Promise<TransactionMetadata | undefined> {
    if (metadata.functionName !== 'ESDTTransfer') {
      return undefined;
    }

    const args = metadata.functionArgs;
    if (args.length < 2) {
      return undefined;
    }

    const tokenIdentifier = BinaryUtils.hexToString(args[0]);
    const value = BinaryUtils.hexToBigInt(args[1]);

    const properties = await this.tokenTransferService.getTokenTransferProperties(tokenIdentifier);
    if (!properties) {
      return undefined;
    }

    const result = new TransactionMetadata();
    result.sender = metadata.sender;
    result.receiver = metadata.receiver;

    if (args.length > 2) {
      result.functionName = BinaryUtils.hexToString(args[2]);
      result.functionArgs = args.slice(3);
    }

    result.transfers = [{
      value,
      properties,
    }];

    result.value = metadata.value;

    return result;
  }
}
