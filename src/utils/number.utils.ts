import BigNumber from 'bignumber.js';
export class NumberUtils {
  static denominate(value: BigInt, decimals: number = 18): number {
    return Number(value.valueOf() / BigInt(Math.pow(10, decimals)));
  }

  static denominateString(value: string, decimals: number = 18): number {
    return NumberUtils.denominate(BigInt(value), decimals);
  }

  static toDenominatedString(amount: BigInt, decimals: number = 18): string {
    let denominatedValue = new BigNumber(amount.toString()).shiftedBy(-decimals).toFixed(decimals);
    if (denominatedValue.includes('.')) {
      denominatedValue = denominatedValue.replace(/0+$/g, '').replace(/\.$/g, '');
    }

    return denominatedValue;
  }

  static numberDecode(encoded: string): string {
    const hex = Buffer.from(encoded, 'base64').toString('hex');
    return new BigNumber(hex, 16).toString(10);
  }
}
