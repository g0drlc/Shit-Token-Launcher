import dotenv from 'dotenv'
import fs from 'fs'

dotenv.config()

export const retrieveEnvVariable = (variableName: string) => {
  const variable = process.env[variableName] || ''
  if (!variable) {
    console.log(`${variableName} is not set`)
    process.exit(1)
  }
  return variable
}

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function calcNonDecimalValue(value: number, decimals: number): number {
  return Math.trunc(value * (Math.pow(10, decimals)))
}

export function calcDecimalValue(value: number, decimals: number): number {
  return value / (Math.pow(10, decimals))
}

export async function getNullableResultFromPromise<T>(value: Promise<T>, opt?: { or?: T, logError?: boolean }): Promise<T | null> {
  return value.catch((error) => {
    if (opt) console.log({ error })
    return opt?.or != undefined ? opt.or : null
  })
}


import { Connection, GetProgramAccountsFilter, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { connection } from "../config";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { SPL_ACCOUNT_LAYOUT, TokenAccount } from "@raydium-io/raydium-sdk";
import base58 from "bs58";
import { PoolInfo, PoolInfoStr } from "./types";


/**
 *   
 * For Market Creation
 * 
 */


export const EVENT_QUEUE_LENGTH = 2978;
export const EVENT_SIZE = 88;
export const EVENT_QUEUE_HEADER_SIZE = 32;

export const REQUEST_QUEUE_LENGTH = 63;
export const REQUEST_SIZE = 80;
export const REQUEST_QUEUE_HEADER_SIZE = 32;

export const ORDERBOOK_LENGTH = 909;
export const ORDERBOOK_NODE_SIZE = 72;
export const ORDERBOOK_HEADER_SIZE = 40;

// export async function getVaultOwnerAndNonce(
//   marketAddress: PublicKey,
//   dexAddress: PublicKey
// ): Promise<[vaultOwner: PublicKey, nonce: BN]> {
//   const nonce = new BN(0);
//   // eslint-disable-next-line no-constant-condition
//   while (true) {
//     try {
//       const vaultOwner = await PublicKey.createProgramAddress(
//         [marketAddress.toBuffer(), nonce.toArrayLike(Buffer, "le", 8)],
//         dexAddress
//       );
//       return [vaultOwner, nonce];
//     } catch (e) {
//       nonce.iaddn(1);
//     }
//   }
// }

export function calculateTotalAccountSize(
  individualAccountSize: number,
  accountHeaderSize: number,
  length: number
) {
  const accountPadding = 12;
  const minRequiredSize =
    accountPadding + accountHeaderSize + length * individualAccountSize;

  const modulo = minRequiredSize % 8;

  return modulo <= 4
    ? minRequiredSize + (4 - modulo)
    : minRequiredSize + (8 - modulo + 4);
}

export function calculateAccountLength(
  totalAccountSize: number,
  accountHeaderSize: number,
  individualAccountSize: number
) {
  const accountPadding = 12;
  return Math.floor(
    (totalAccountSize - accountPadding - accountHeaderSize) /
    individualAccountSize
  );
}

export const outputBalance = async (solAddress: PublicKey) => {
  const bal = await connection.getBalance(solAddress, "processed") / LAMPORTS_PER_SOL
  console.log("Balance in ", solAddress.toBase58(), " is ", bal, "SOL")
  return bal
}

/**
 * 
 *  For pool creation
 * 
 */

export async function getTokenAccountBalance(
  connection: Connection,
  wallet: string,
  mint_token: string
) {
  const filters: GetProgramAccountsFilter[] = [
    {
      dataSize: 165, //size of account (bytes)
    },
    {
      memcmp: {
        offset: 32, //location of our query in the account (bytes)
        bytes: wallet, //our search criteria, a base58 encoded string
      },
    },
    //Add this search parameter
    {
      memcmp: {
        offset: 0, //number of bytes
        bytes: mint_token, //base58 encoded string
      },
    },
  ];
  const accounts = await connection.getParsedProgramAccounts(TOKEN_PROGRAM_ID, {
    filters: filters,
  });

  for (const account of accounts) {
    const parsedAccountInfo: any = account.account.data;
    // const mintAddress: string = parsedAccountInfo["parsed"]["info"]["mint"];
    const tokenBalance: number = parseInt(
      parsedAccountInfo["parsed"]["info"]["tokenAmount"]["amount"]
    );

    // console.log(
    //   `Account: ${account.pubkey.toString()} - Mint: ${mintAddress} - Balance: ${tokenBalance}`
    // );

    if (tokenBalance) {
      return tokenBalance;
    }
  }
}

export function assert(condition: any, msg?: string): asserts condition {
  if (!condition) {
    throw new Error(msg);
  }
}

export async function getWalletTokenAccount(
  connection: Connection,
  wallet: PublicKey
): Promise<TokenAccount[]> {
  const walletTokenAccount = await connection.getTokenAccountsByOwner(wallet, {
    programId: TOKEN_PROGRAM_ID,
  });
  return walletTokenAccount.value.map((i) => ({
    pubkey: i.pubkey,
    programId: i.account.owner,
    accountInfo: SPL_ACCOUNT_LAYOUT.decode(i.account.data),
  }));
}



/**
 * 
 *  Pool remove part
 * 
 */


export async function getATAAddress(
  programId: PublicKey,
  owner: PublicKey,
  mint: PublicKey
) {
  const [publicKey, nonce] = await PublicKey.findProgramAddress(
    [owner.toBuffer(), programId.toBuffer(), mint.toBuffer()],
    new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
  );
  return { publicKey, nonce };
}

export function readJson(filename: string = "data.json"): PoolInfoStr {
  try {
    if (!fs.existsSync(filename)) {
      // If the file does not exist, create an empty array
      return {
        mint: null,
        marketId: null,
        poolId: null,
        mainKp: null,
        poolKeys: null,
        removed: false
      }
    }
    const data = fs.readFileSync(filename, 'utf-8');
    const parsedData = JSON.parse(data)
    return parsedData
  } catch (error) {
    return {
      mint: null,
      marketId: null,
      poolId: null,
      mainKp: null,
      poolKeys: null,
      removed: false
    }
  }
}

export const saveDataToFile = (newData: PoolInfo, filePath: string = "data.json") => {
  try {
    // let existingData: PoolInfo

    // Check if the file exists
    if (fs.existsSync(filePath)) {
      // try {
      //   // If the file exists, read its content
      //   const fileContent = fs.readFileSync(filePath, 'utf-8');
      //   existingData = JSON.parse(fileContent);
      // } catch (parseError) {
      //   // If there is an error parsing the file, delete the corrupted file
      //   console.error('Error parsing JSON file, deleting corrupted file:', parseError);
      fs.unlinkSync(filePath);
      // }
    }

    // Write the updated data back to the file
    fs.writeFileSync(filePath, JSON.stringify(newData, null, 2));

  } catch (error) {
    console.log('Error saving data to JSON file:', error);
  }
};
