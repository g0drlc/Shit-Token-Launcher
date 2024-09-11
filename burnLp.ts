import { Keypair, PublicKey, Transaction, TransactionMessage, VersionedTransaction } from "@solana/web3.js"
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
import { createBurnCheckedInstruction, getAssociatedTokenAddress, unpackMint } from "@solana/spl-token";
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

import bs58 from 'bs58'

type WalletTokenAccounts = Awaited<ReturnType<typeof getWalletTokenAccount>>

const recoveryMode = retrieveEnvVariable("RECOVERY_MODE") == "true"
const programId = cluster == "devnet" ? DEVNET_PROGRAM_ID : MAINNET_PROGRAM_ID

const single = async (token: UserToken) => {
  let params: PoolInfo
  try {
    // if (recoveryMode == true) {
    const data = readJson()
    //   if (!data.mainKp) {
    //     console.log("Main keypair is not set")
    //     return
    //   }
    //   params = {
    //     mint: data.mint ? new PublicKey(data.mint) : null,
    //     marketId: data.marketId ? new PublicKey(data.marketId) : null,
    //     poolId: data.poolId ? new PublicKey(data.poolId) : null,
    //     mainKp: data.mainKp,
    //     poolKeys: null,
    //     removed: data.removed
    //   }
    // } else
    params = {
      mint: data.mint ? new PublicKey(data.mint) : null,
      marketId: data.marketId ? new PublicKey(data.marketId) : null,
      poolId: data.poolId ? new PublicKey(data.poolId) : null,
      mainKp: data.mainKp,
      poolKeys: data.poolKeys,
      removed: data.removed
    }

    const MINT_ADDRESS = new PublicKey(params.poolKeys?.lpMint!);
    const MINT_DECIMALS = params.poolKeys?.baseDecimals;
    const BURN_QUANTITY = 100;

    if (!params.mainKp) return;
    const mainPkStr = params.mainKp
    const mainKeypair = Keypair.fromSecretKey(bs58.decode(mainPkStr))
    const account = await getAssociatedTokenAddress(MINT_ADDRESS!, mainKeypair.publicKey);
    
    console.log("🚀 ~ single ~ account:", account)

    const burnIx = createBurnCheckedInstruction(
      account,
      MINT_ADDRESS!,
      mainKeypair.publicKey,
      BURN_QUANTITY,
      MINT_DECIMALS!
    );

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');

    const messageV0 = new TransactionMessage({
      payerKey: mainKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions: [burnIx]
    }).compileToV0Message();
    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([mainKeypair]);

    const txid = await connection.sendTransaction(transaction);

    const confirmation = await connection.confirmTransaction({
      signature: txid,
      blockhash: blockhash,
      lastValidBlockHeight: lastValidBlockHeight
    });
    if (confirmation.value.err) { throw new Error("    ❌ - Transaction not confirmed.") }
    console.log('🔥 SUCCESSFUL BURN!🔥', '\n', `https://explorer.solana.com/tx/${txid}?cluster=devnet`);

  } catch (error) {
    console.log("Error happened in one of the token flow", error)
  }
}

const main = async () => {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    console.log(`Token ${i + 1} is to be created`)
    await single(token)
    // await removeLiquidity()
    await sleep(10000)
    console.log("One token process is ended, and go for next one")
  }
}

main()
