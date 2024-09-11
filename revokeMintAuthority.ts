import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, MintLayout, AuthorityType, createSetAuthorityInstruction, getAssociatedTokenAddress } from '@solana/spl-token';
import { Connection, PublicKey, Transaction, SystemProgram, Keypair, TransactionInstruction } from '@solana/web3.js';
import bs58 from 'bs58'
import { PoolInfo } from './src/types';
import { readJson } from './src/utils';
import { connection } from './config';
import { sendAndConfirmTransaction } from '@solana/web3.js';

async function revokeMintAuthority(
) {
    let params: PoolInfo
    try {
        const data = readJson()

        params = {
            mint: data.mint ? new PublicKey(data.mint) : null,
            marketId: data.marketId ? new PublicKey(data.marketId) : null,
            poolId: data.poolId ? new PublicKey(data.poolId) : null,
            mainKp: data.mainKp,
            poolKeys: data.poolKeys,
            removed: data.removed
        }

        if (!params.mainKp) return;
        const MINT_ADDRESS = params.mint;
        const mainPkStr = params.mainKp
        const mainKeypair = Keypair.fromSecretKey(bs58.decode(mainPkStr))
        const account = await getAssociatedTokenAddress(MINT_ADDRESS!, mainKeypair.publicKey);
        console.log("🚀 ~ MINT_ADDRESS:", MINT_ADDRESS)
        console.log("🚀 ~ mainKeypair.publicKey:", mainKeypair.publicKey.toBase58())
        console.log("🚀 ~ account:", account.toBase58())
        
        const authorityType = AuthorityType.MintTokens

        if (mainKeypair.publicKey) {
            const transaction = new Transaction().add(
                createSetAuthorityInstruction(
                    MINT_ADDRESS!,
                    mainKeypair.publicKey,
                    authorityType,
                    null
                )
            )

            transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
            transaction.feePayer = mainKeypair.publicKey;
            console.log(await connection.simulateTransaction(transaction))

            try {
                const signature = await sendAndConfirmTransaction(connection, transaction, [mainKeypair])
                console.log("signature ====>", signature);
            } catch (err) {
                console.log("revoking error ====>", err);
            }
        }

    } catch (error) {
        console.log("Error happened in one of the token flow", error)
    }
}

revokeMintAuthority();