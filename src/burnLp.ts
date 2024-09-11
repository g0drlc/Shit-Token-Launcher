import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, MintLayout, Token } from '@solana/spl-token';
import { Connection, PublicKey, Transaction, SystemProgram, Keypair, TransactionInstruction, sendAndConfirmRawTransaction, sendAndConfirmTransaction } from '@solana/web3.js';

export async function burnToken(
    connection: Connection,
    mainKp: Keypair,
    mintAddress: PublicKey,
    tokenAccount: PublicKey
) {
    if (mainKp.publicKey != null) {
        const amount = await connection.getTokenAccountBalance(tokenAccount);
        console.log("LP token amount ===>", amount);
        if (amount.value.uiAmount == null) {
            alert("amount is 0");
            return;
        }
        const burnInstruction = Token.createBurnInstruction(TOKEN_PROGRAM_ID, mintAddress, tokenAccount, mainKp.publicKey, [], amount.value.uiAmount * 10 ** amount.value.decimals);
        const transaction = new Transaction();
        transaction.add(burnInstruction);
        const lastBlockHash = await connection.getLatestBlockhash();
        transaction.recentBlockhash = lastBlockHash.blockhash;
        transaction.feePayer = mainKp.publicKey;
        console.log(await connection.simulateTransaction(transaction))

        const signature = await sendAndConfirmTransaction(connection, transaction, [mainKp]);
        console.log("transaction signature ===>", signature);

    }
}