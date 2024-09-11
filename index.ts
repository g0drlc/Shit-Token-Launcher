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
import { createPool } from "./src/createPool"
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

const single = async (token: UserToken) => {
  let params: PoolInfo
  try {
    if (recoveryMode == true) {
      const data = readJson()
      if (!data.mainKp) {
        console.log("Main keypair is not set")
        return
      }
      params = {
        mint: data.mint ? new PublicKey(data.mint) : null,
        marketId: data.marketId ? new PublicKey(data.marketId) : null,
        poolId: data.poolId ? new PublicKey(data.poolId) : null,
        mainKp: data.mainKp,
        poolKeys: null,
        removed: data.removed
      }
    } else
      params = {
        mint: null,
        marketId: null,
        poolId: null,
        mainKp: token.mainKp,
        poolKeys: null,
        removed: false
      }

    const mainKp = Keypair.fromSecretKey(base58.decode(params.mainKp!))
    if (!mainKp) {
      console.log("Main keypair is not set in recovery mode")
      return
    }
    await outputBalance(mainKp.publicKey)

    // create token
    console.log("\n***************************************************************\n")
    let tokenCreationFailed = 0
    while (true) {
      if (params.mint && recoveryMode) {
        console.log("Token already created before, ", params.mint.toBase58())
        break
      }
      if (tokenCreationFailed > 5) {
        console.log("Token creation is failed in repetition, Terminate the process")
        return
      }
      const mintResult = await createTokenWithMetadata(token)
      if (!mintResult) {
        console.log("Token creation error, trying again")
        tokenCreationFailed++
      } else {
        const { amount, mint } = mintResult
        params.mint = mint
        await outputBalance(mainKp.publicKey)
        await sleep(5000)
        saveDataToFile(params)
        break
      }
    }

    // create market
    console.log("\n***************************************************************\n")
    let marketCreationFailed = 0
    while (true) {
      if (params.marketId && recoveryMode) {
        console.log("Market id already created before, ", params.marketId.toBase58())
        break
      }
      if (marketCreationFailed > 5) {
        console.log("Market creation is failed in repetition, Terminate the process")
        return
      }
      const marketId = await createMarket(mainKp, params.mint)
      if (!marketId) {
        console.log("Market creation error")
        marketCreationFailed++
      } else {
        params.marketId = marketId
        await outputBalance(mainKp.publicKey)
        await sleep(3000)
        saveDataToFile(params)
        break
      }
    }

    // create pool and bundle buy
    console.log("\n***************************************************************\n")

    // create pool and bundle buy with several wallets
    txCreateNewPoolAndBundleBuy()

    // if (!params.poolId) {
    //   console.log("Pool id is not set in params")
    //   return
    // }

  } catch (error) {
    console.log("Error happened in one of the token flow", error)
  }
}

const removeLiquidity = async() => {
  // remove liquidity
  console.log("\n***************************************************************\n")
  await sleep(5000)
  const data = readJson()
  let params = {
    mint: data.mint ? new PublicKey(data.mint) : null,
    marketId: data.marketId ? new PublicKey(data.marketId) : null,
    poolId: data.poolId ? new PublicKey(data.poolId) : null,
    mainKp: data.mainKp,
    poolKeys: data.poolKeys,
    removed: data.removed
  }
  let removeTried = 0
  while (true) {
    if (removeTried > 10) {
      console.log("Remove liquidity transaction called many times, pull tx failed")
      return
    }
    // const removed = await ammRemoveLiquidity(LP_wallet_keypair, params.poolId!, params.poolKeys)
    const removed = await ammRemoveLiquidity(LP_wallet_keypair, params.poolId!)
    if (removed) {
      params.removed = true
      saveDataToFile(params)
      console.log("Single token has been completed through process")
      await sleep(2000)
      console.log("\n***************************************************************\n")
      console.log(" Preparing for a new token")
      return
    } else {
      console.log("Failed to remove liquidity")
      removeTried++
    }
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
