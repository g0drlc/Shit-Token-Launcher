import {
  buildSimpleTransaction,
  InnerSimpleV0Transaction,
  LiquidityPoolKeysV4,
  LOOKUP_TABLE_CACHE,
  TokenAccount,
  TokenAmount,
  TxVersion,
} from "@raydium-io/raydium-sdk";
import {
  Connection,
  Keypair,
  SendOptions,
  Signer,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { Liquidity } from "@raydium-io/raydium-sdk";
import { cluster, connection } from "../config";

export async function sendTx(
  connection: Connection,
  payer: Keypair | Signer,
  txs: (VersionedTransaction | Transaction)[],
  options?: SendOptions
): Promise<string[]> {
  const txids: string[] = [];
  for (const iTx of txs) {
    if (iTx instanceof VersionedTransaction) {
      iTx.sign([payer]);
      txids.push(await connection.sendTransaction(iTx, options));
    } else {
      txids.push(await connection.sendTransaction(iTx, [payer], options));
    }
  }
  return txids;
}

export async function buildAndSendTx(
  keypair: Keypair,
  innerSimpleV0Transaction: InnerSimpleV0Transaction[],
) {
  const willSendTx = await buildSimpleTransaction({
    connection,
    makeTxVersion: TxVersion.V0,
    payer: keypair.publicKey,
    innerTransactions: innerSimpleV0Transaction,
    addLookupTableInfo: cluster == "devnet" ? undefined : LOOKUP_TABLE_CACHE,
  });

  return await sendTx(connection, keypair, willSendTx, { skipPreflight: true });
}

export async function build_swap_buy_instructions(
  connection: Connection,
  poolKeys: LiquidityPoolKeysV4,
  tokenAccountRawInfos_Swap: TokenAccount[],
  keypair: Keypair,
  inputTokenAmount: TokenAmount,
  minAmountOut: TokenAmount
) {
  const { innerTransactions } = await Liquidity.makeSwapInstructionSimple({
    connection,
    poolKeys,
    userKeys: {
      tokenAccounts: tokenAccountRawInfos_Swap,
      owner: keypair.publicKey,
    },
    amountIn: inputTokenAmount,
    amountOut: minAmountOut,
    fixedSide: "in",
    makeTxVersion: TxVersion.V0,
    computeBudgetConfig: { microLamports: 300_000, units: 400_000 },
  });

  return innerTransactions;
}

export async function build_swap_sell_instructions(
  connection: Connection,
  poolKeys: LiquidityPoolKeysV4,
  tokenAccountRawInfos_Swap: TokenAccount[],
  keypair: Keypair,
  inputTokenAmount: TokenAmount,
  minAmountOut: TokenAmount
) {
  const { innerTransactions } = await Liquidity.makeSwapInstructionSimple({
    connection,
    poolKeys,
    userKeys: {
      tokenAccounts: tokenAccountRawInfos_Swap,
      owner: keypair.publicKey,
    },
    amountIn: inputTokenAmount,
    amountOut: minAmountOut,
    fixedSide: "out",
    makeTxVersion: TxVersion.V0,
    computeBudgetConfig: { microLamports: 300_000, units: 400_000 },
  });

  return innerTransactions;
}
