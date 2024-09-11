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
import { unpackMint } from "@solana/spl-token";
import base58 from "bs58"
import BN from "bn.js"

import { createMarket } from "./createMarket"
import { createTokenWithMetadata } from "./createTokenPinata"
import { outputBalance, readJson, retrieveEnvVariable, saveDataToFile, sleep } from "./utils"
import { PoolInfo, UserToken } from './types'
import {
    getTokenAccountBalance,
    assert,
    getWalletTokenAccount,
} from "../utils/get_balance";
import { buildAndSendTx, build_swap_instructions, build_create_pool_instructions } from "../utils/build_a_sendtxn";
import {
    connection,
    addLookupTableInfo, cluster, makeTxVersion, poolCreationInterval, tokens,
    LP_wallet_keypair, swap_wallet_keypair,
    quote_Mint_amount,
    input_baseMint_tokens_percentage,
    lookupTableCache,
    delay_pool_open_time, DEFAULT_TOKEN, swap_sol_amount,
    swapWallets
} from "../config";

import { executeVersionedTx } from "./execute";
import { jitoWithAxios } from "./jitoWithAxios";

const programId = cluster == "devnet" ? DEVNET_PROGRAM_ID : MAINNET_PROGRAM_ID

export async function txCreateNewPoolAndBundleBuy() {
    console.log("LP Wallet Address: ", LP_wallet_keypair.publicKey.toString());

    const data = readJson()
    let params: any = {
        mint: data.mint ? new PublicKey(data.mint) : null,
        marketId: data.marketId ? new PublicKey(data.marketId) : null,
        poolId: data.poolId ? new PublicKey(data.poolId) : null,
        mainKp: data.mainKp,
        poolKeys: null,
        removed: data.removed
    }

    // ------- get pool keys
    console.log("------------- get pool keys for pool creation---------")

    const tokenAccountRawInfos_LP = await getWalletTokenAccount(
        connection,
        LP_wallet_keypair.publicKey
    )

    if (!params.marketId) {
        console.log("Market Id is not set.");
        return;
    }

    const marketBufferInfo = await connection.getAccountInfo(params.marketId);
    console.log("🚀 ~ txCreateNewPoolAndBundleBuy ~ marketBufferInfo:", marketBufferInfo)
    if (!marketBufferInfo) return;
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
    } = MARKET_STATE_LAYOUT_V3.decode(marketBufferInfo.data);
    console.log("Base mint: ", baseMint.toString());
    console.log("Quote mint: ", quoteMint.toString());

    const accountInfo_base = await connection.getAccountInfo(baseMint);
    console.log("🚀 ~ txCreateNewPoolAndBundleBuy ~ accountInfo_base:", accountInfo_base)
    if (!accountInfo_base) return;
    const baseTokenProgramId = accountInfo_base.owner;
    const baseDecimals = unpackMint(
        baseMint,
        accountInfo_base,
        baseTokenProgramId
    ).decimals;
    console.log("Base Decimals: ", baseDecimals);

    const accountInfo_quote = await connection.getAccountInfo(quoteMint);
    console.log("🚀 ~ txCreateNewPoolAndBundleBuy ~ accountInfo_quote:", accountInfo_quote)
    if (!accountInfo_quote) return;
    const quoteTokenProgramId = accountInfo_quote.owner;
    const quoteDecimals = unpackMint(
        quoteMint,
        accountInfo_quote,
        quoteTokenProgramId
    ).decimals;
    console.log("Quote Decimals: ", quoteDecimals);

    const associatedPoolKeys = await Liquidity.getAssociatedPoolKeys({
        version: 4,
        marketVersion: 3,
        baseMint,
        quoteMint,
        baseDecimals,
        quoteDecimals,
        marketId: params.marketId,
        programId: programId.AmmV4,
        marketProgramId: programId.OPENBOOK_MARKET,
    });
    const { id: ammId, lpMint } = associatedPoolKeys;
    params.poolId = associatedPoolKeys.id
    params.poolKeys = associatedPoolKeys

    saveDataToFile(params)

    console.log("AMM ID: ", ammId.toString());
    console.log("lpMint: ", lpMint.toString());

    // --------------------------------------------
    let quote_amount = quote_Mint_amount * 10 ** quoteDecimals;
    // -------------------------------------- Get balance
    let base_balance: number;
    let quote_balance: number;

    if (baseMint.toString() == "So11111111111111111111111111111111111111112") {
        base_balance = await connection.getBalance(LP_wallet_keypair.publicKey);
        if (!base_balance) return;
        console.log("SOL Balance:", base_balance);
    } else {
        const temp = await getTokenAccountBalance(
            connection,
            LP_wallet_keypair.publicKey.toString(),
            baseMint.toString()
        );
        base_balance = temp || 0;
    }

    if (quoteMint.toString() == "So11111111111111111111111111111111111111112") {
        quote_balance = await connection.getBalance(LP_wallet_keypair.publicKey);
        if (!quote_balance) return;
        console.log("SOL Balance:", quote_balance);
        assert(
            quote_amount <= quote_balance,
            "Sol LP input is greater than current balance"
        );
    } else {
        const temp = await getTokenAccountBalance(
            connection,
            LP_wallet_keypair.publicKey.toString(),
            quoteMint.toString()
        );
        quote_balance = temp || 0;
    }

    let base_amount_input = Math.ceil(base_balance * input_baseMint_tokens_percentage);
    console.log("Input Base: ", base_amount_input);

    let versionedTxs: VersionedTransaction[] = []

    // step2: init new pool (inject money into the created pool)
    const lp_ix = await build_create_pool_instructions(
        programId,
        params.marketId,
        LP_wallet_keypair,
        tokenAccountRawInfos_LP,
        baseMint,
        baseDecimals,
        quoteMint,
        quoteDecimals,
        delay_pool_open_time,
        base_amount_input,
        quote_amount,
        lookupTableCache
    );
    console.log("-------- pool creation instructions [DONE] ---------\n")

    const createPoolRecentBlockhash = (await connection.getLatestBlockhash().catch(async () => {
        // await sleep(2_000)
        return await connection.getLatestBlockhash().catch(getLatestBlockhashError => {
            console.log({ getLatestBlockhashError })
            return null
        })
    }))?.blockhash;
    if (!createPoolRecentBlockhash) return { Err: "Failed to prepare transaction" }

    const createPoolTransaction = (await buildSimpleTransaction({
        connection,
        makeTxVersion: TxVersion.V0,
        payer: LP_wallet_keypair.publicKey,
        innerTransactions: lp_ix,
        addLookupTableInfo: addLookupTableInfo,
        recentBlockhash: createPoolRecentBlockhash
    })) as VersionedTransaction[];
    createPoolTransaction[0].sign([LP_wallet_keypair]);

    // console.log("🚀 ~ txCreateNewPoolAndBundleBuy ~ createVersionedTx:", createVersionedTx)
    console.log((await connection.simulateTransaction(createPoolTransaction[0], undefined)));
    // console.log("🚀 ~ txCreateNewPoolAndBundleBuy ~ createVersionedTx:", createVersionedTx)

    versionedTxs.push(createPoolTransaction[0])

    // create pool

    console.log("\n***************************************************************\n")
    if (cluster == "devnet") {
        const createSig = await executeVersionedTx(createPoolTransaction[0])
        const createPoolTx = createSig ? `https://solscan.io/tx/${createSig}${cluster == "devnet" ? "?cluster=devnet" : ""}` : ''
        console.log("Pool created ", createPoolTx)
        console.log("\n***************************************************************\n")
        await outputBalance(LP_wallet_keypair.publicKey)
    }

    // -------------------------------------------------
    // ---- Swap info

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
    console.log("🚀 ~ txCreateNewPoolAndBundleBuy ~ targetPoolInfo:", targetPoolInfo)

    const poolKeys = jsonInfo2PoolKeys(targetPoolInfo) as LiquidityPoolKeys;
    
    console.log("\n -------- Now getting swap instructions --------");

    const TOKEN_TYPE = new Token(TOKEN_PROGRAM_ID, baseMint, baseDecimals, 'ABC', 'ABC')

    let inputTokenAmount
    let minAmountOut
    let tokenAccountRawInfos_Swap
    let swapTransaction
    for (let i = 0; i < swapWallets.length; i++) {
        inputTokenAmount = new TokenAmount(DEFAULT_TOKEN.WSOL, (swap_sol_amount * (10 ** quoteDecimals)))
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

        // console.log("Swap wsol [Lamports]: ",inputTokenAmount.raw.words[0])
        // console.log("Min Amount Out[Lamports]: ",minAmountOut.raw.words[0])
        // console.log("Swap wsol [Lamports]: ", inputTokenAmount)
        // console.log("Min Amount Out[Lamports]: ", minAmountOut)

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

        // console.log("Getting recent blockhash: ", blockhash)
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

        if (cluster == "devnet") {
            const buySig = await executeVersionedTx(swapTransaction[0])
            const tokenBuyTx = buySig ? `https://solscan.io/tx/${buySig}${cluster == "devnet" ? "?cluster=devnet" : ""}` : ''
            console.log("Token bought: ", tokenBuyTx)
            console.log("\n*******************************************************************************************")
        }
        await outputBalance(LP_wallet_keypair.publicKey)
    }
    // swap ix end ------------------------------------------------------------

    // if (cluster == "devnet") {
    //     versionedTxs.forEach(
    //         async (eachTx, index) => {
    //             const sig = await executeVersionedTx(eachTx)
    //             const sigShow = sig ? `https://solscan.io/tx/${sig}?cluster=devnet` : '';
    //             console.log(index == 0 ? "Pool created: " : "Token bought: ", sigShow);
    //         }
    //     )
    // }
    // if(cluster == "devnet") {
    //     const result = await bundle(versionedTxs, LP_wallet_keypair, connection)
    //     console.log("Bundling result: ", result);
    // }

    
    if (cluster == "mainnet") {
        console.log("------------- Bundle & Send ---------")
        console.log("Please wait for 30 seconds for bundle to be completely executed by all nearests available leaders!");
        let result;
        while (1) {
            result = await jitoWithAxios(versionedTxs, LP_wallet_keypair)
            if (result.confirmed) break;
        }
    }

    console.log("------------- Bundle Successful ---------");
}