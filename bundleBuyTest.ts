import { Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js"
import {
  DEVNET_PROGRAM_ID,
  jsonInfo2PoolKeys,
  Liquidity,
  MAINNET_PROGRAM_ID,
  MARKET_STATE_LAYOUT_V3, LiquidityPoolKeys,
  Token, TokenAmount, ZERO, ONE, TEN,
  TOKEN_PROGRAM_ID, parseBigNumberish, bool,
  buildSimpleTransaction,
  TxVersion
} from "@raydium-io/raydium-sdk"
import { unpackMint } from "@solana/spl-token";
import base58 from "bs58"
import BN from "bn.js"

import { addLookupTableInfo, cluster, makeTxVersion, poolCreationInterval, tokens } from "./config"
import { createMarket } from "./src/createMarket"
import { createTokenWithMetadata } from "./src/createTokenPinata"
import { outputBalance, readJson, retrieveEnvVariable, saveDataToFile, sleep } from "./src/utils"
import { PoolInfo, UserToken } from './src/types'
import {
  getTokenAccountBalance,
  assert,
  getWalletTokenAccount,
} from "./utils/get_balance";
import { buildAndSendTx, build_swap_instructions, build_create_pool_instructions } from "./utils/build_a_sendtxn";
import {
  connection,
  LP_wallet_keypair, swap_wallet_keypair,
  quote_Mint_amount,
  input_baseMint_tokens_percentage,
  lookupTableCache,
  delay_pool_open_time, DEFAULT_TOKEN, swap_sol_amount,
  swapWallets
} from "./config";

import { jitoWithAxios } from "./src/jitoWithAxios";
import { token } from "@metaplex-foundation/js";
import { executeVersionedTx } from "./src/execute";
import { txCreateNewPoolAndBundleBuy } from "./src/createPoolAndBundleBuy";
import { ammRemoveLiquidity } from "./src/removeLiquidity";

type WalletTokenAccounts = Awaited<ReturnType<typeof getWalletTokenAccount>>

const recoveryMode = retrieveEnvVariable("RECOVERY_MODE") == "true"
const programId = cluster == "devnet" ? DEVNET_PROGRAM_ID : MAINNET_PROGRAM_ID

const single = async () => {
  try {

    // const baseMint = new PublicKey("So11111111111111111111111111111111111111112")
    // const quoteMint = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")
    const marketId = new PublicKey("B2Xxq8qLH7cD4fx4xUeMa4DWTfcRXGatCsyhHZxm5td8")

    let versionedTxs: VersionedTransaction[] = []

    const tokenAccountRawInfos_LP = await getWalletTokenAccount(
      connection,
      LP_wallet_keypair.publicKey
    )

    const marketBufferInfo = await connection.getAccountInfo(marketId);

    const {
      baseMint,
      quoteMint,
      baseLotSize,
      quoteLotSize,
      baseVault: marketBaseVault,
      quoteVault: marketQuoteVault,
      bids: marketBids,
      asks: marketAsks,
      eventQueue: marketEventQueue
    } = MARKET_STATE_LAYOUT_V3.decode(marketBufferInfo!.data);

    const associatedPoolKeys = await Liquidity.getAssociatedPoolKeys({
      version: 4,
      marketVersion: 3,
      baseMint,
      quoteMint,
      baseDecimals: 9,
      quoteDecimals: 6,
      marketId: marketId,
      programId: programId.AmmV4,
      marketProgramId: programId.OPENBOOK_MARKET,
    });

    const targetPoolInfo = {
      id: associatedPoolKeys.id.toString(),
      baseMint: associatedPoolKeys.baseMint.toString(),
      quoteMint: associatedPoolKeys.quoteMint.toString(),
      lpMint: associatedPoolKeys.lpMint.toString(),
      baseDecimals: associatedPoolKeys.baseDecimals,
      quoteDecimals: associatedPoolKeys.quoteDecimals,
      lpDecimals: associatedPoolKeys.lpDecimals,
      version: 4,
      programId: associatedPoolKeys.programId.toString(),
      authority: associatedPoolKeys.authority.toString(),
      openOrders: associatedPoolKeys.openOrders.toString(),
      targetOrders: associatedPoolKeys.targetOrders.toString(),
      baseVault: associatedPoolKeys.baseVault.toString(),
      quoteVault: associatedPoolKeys.quoteVault.toString(),
      withdrawQueue: associatedPoolKeys.withdrawQueue.toString(),
      lpVault: associatedPoolKeys.lpVault.toString(),
      marketVersion: 3,
      marketProgramId: associatedPoolKeys.marketProgramId.toString(),
      marketId: associatedPoolKeys.marketId.toString(),
      marketAuthority: associatedPoolKeys.marketAuthority.toString(),
      marketBaseVault: marketBaseVault.toString(),
      marketQuoteVault: marketQuoteVault.toString(),
      marketBids: marketBids.toString(),
      marketAsks: marketAsks.toString(),
      marketEventQueue: marketEventQueue.toString(),
      lookupTableAccount: PublicKey.default.toString(),
    };

    const poolKeys = jsonInfo2PoolKeys(targetPoolInfo) as LiquidityPoolKeys;

    const TOKEN_TYPE = new Token(TOKEN_PROGRAM_ID, quoteMint, 6)

    const inputTokenAmount = new TokenAmount(DEFAULT_TOKEN.WSOL, (0.005 * (10 ** 9)))
    let minAmountOut
    let tokenAccountRawInfos_Swap
    let swapTransaction
    for (let i = 0; i < 2; i++) {
      minAmountOut = new TokenAmount(TOKEN_TYPE, 1)

      const buyRecentBlockhash = (await connection.getLatestBlockhash().catch(async () => {
        // await sleep(2_000)
        return await connection.getLatestBlockhash().catch(getLatestBlockhashError => {
          console.log({ getLatestBlockhashError })
          return null
        })
      }))?.blockhash;
      if (!buyRecentBlockhash) return { Err: "Failed to prepare transaction" }

      tokenAccountRawInfos_Swap = await getWalletTokenAccount(
        connection,
        swapWallets[i].publicKey
      )

      const swap_ix = await build_swap_instructions(
        connection,
        poolKeys,
        tokenAccountRawInfos_Swap,
        swapWallets[i],
        inputTokenAmount,
        minAmountOut,
        lookupTableCache
      )
      console.log("-------- swap coin instructions [DONE] ---------\n")

      swapTransaction = (await buildSimpleTransaction({
        connection,
        makeTxVersion: TxVersion.V0,
        payer: swapWallets[i].publicKey,
        innerTransactions: swap_ix,
        addLookupTableInfo: addLookupTableInfo,
        recentBlockhash: buyRecentBlockhash
      })) as VersionedTransaction[];
      swapTransaction[0].sign([swapWallets[i]])

      console.log((await connection.simulateTransaction(swapTransaction[0], undefined)))
      versionedTxs.push(swapTransaction[0])

    }

    console.log("------------- Bundle & Send ---------")
    console.log("Please wait for 30 seconds for bundle to be completely executed by all nearests available leaders!");
    let result;
    while (1) {
      result = await jitoWithAxios(versionedTxs, LP_wallet_keypair)
      if (result.confirmed) break;
    }

    await outputBalance(swapWallets[0].publicKey)
    await outputBalance(swapWallets[1].publicKey)
    await outputBalance(LP_wallet_keypair.publicKey)

  } catch (error) {
    console.log("Error happened in one of the token flow", error)
  }
}

const main = async () => {
    console.log(`Bundle Buy Test`)
    await single()
    await sleep(10000)
    console.log("Bundle Buy process is ended")
}

main()
