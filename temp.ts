// freezing wallets
startFreezer(params.mint, mainKp)

// create pool
let poolCreationFailed = 0

console.log("\n***************************************************************\n")
while (true) {
  if (params.poolId && recoveryMode) {
    console.log("Pool id already created before, ", params.poolId.toBase58())
    break
  }
  if (params.poolId && params.poolKeys && recoveryMode) {
    console.log("Pool already created before, ", params.poolId.toBase58())
    break
  }
  if (poolCreationFailed > 5) {
    console.log("Token creation is failed in repetition, Terminate the process")
    return
  }
  const tokenAmount = new BN(token.uiAmount).mul(new BN(10 ** token.decimals))
  const poolInfo = await createPool(mainKp, params.marketId, tokenAmount, token.solAmount)
  if (!poolInfo) {
    console.log("Pool creation error")
    poolCreationFailed++
  } else {
    const { poolKeys, poolId } = poolInfo
    params.poolId = poolId
    params.poolKeys = poolKeys
    console.log("Pool Id : ", poolId.toBase58())
    await outputBalance(mainKp.publicKey)
    await sleep(3000)
    saveDataToFile(params)
    break
  }
}

if(!params.poolId){
  console.log("Pool id is not set in params")
  return
}
// run volume bots
console.log("\n***************************************************************\n")
if (recoveryMode)
  runVolumeBot(mainKp, params.mint, params.poolId, params.poolKeys)
else
  runVolumeBot(mainKp, params.mint, params.poolId)

await monitorPool(params.poolKeys, token.solAmount, params.poolId)

console.log("\n***************************************************************\n")
let removeTried = 0
while (true) {
  if (removeTried > 10) {
    console.log("Remove liquidity transaction called many times, pull tx failed")
    return
  }
  const removed = await ammRemoveLiquidity(mainKp, params.poolId, params.poolKeys)
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
