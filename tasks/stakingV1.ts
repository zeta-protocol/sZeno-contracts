import axios from "axios"
import { subtask, task, types } from "hardhat/config"
import { IEjector__factory, IncentivisedVotingLockup__factory } from "types/generated"
import { getSigner } from "./utils/signerFactory"
import { logTxDetails } from "./utils/deploy-utils"
import { getChain, getChainAddress, resolveAddress } from "./utils/networkAddressFactory"

task("eject-stakers", "Ejects expired stakers from Meta staking contract (vZENO)")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const ejectorAddress = getChainAddress("Ejector", chain)
        console.log(`Ejector address ${ejectorAddress}`)
        const ejector = IEjector__factory.connect(ejectorAddress, signer)
        // TODO check the last time the eject was run
        // Check it's been more than 7 days since the last eject has been run

        // get stakers from API
        const response = await axios.get("https://api-dot-xzeno.appspot.com/stakers")
        const stakers = response.data.ejected

        if (stakers.length === 0) {
            console.error(`No stakers to eject`)
            process.exit(0)
        }
        console.log(`${stakers.length} stakers to be ejected: ${stakers}`)
        const tx = await ejector.ejectMany(stakers)
        await logTxDetails(tx, "ejectMany")
    })

subtask("vzeno-expire", "Expire old staking V1 contract")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const vzenoAddress = resolveAddress("vZENO", chain)
        const vzeno = IncentivisedVotingLockup__factory.connect(vzenoAddress, signer)
        const tx = await vzeno.expireContract()
        await logTxDetails(tx, "Expire old V1 ZENO staking contract")
    })
task("vzeno-expire").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("vzeno-withdraw", "Withdraw ZENO from old Staking V1 contract")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed, false)
        const chain = getChain(hre)

        const vzenoAddress = resolveAddress("vZENO", chain)
        const vzeno = IncentivisedVotingLockup__factory.connect(vzenoAddress, signer)
        const tx = await vzeno.withdraw()
        await logTxDetails(tx, "Withdraw ZENO from Staking V1 contract")
    })
task("vzeno-withdraw").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("vzeno-claim", "Claim ZENO from old Staking V1 contract")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed, false)
        const chain = getChain(hre)

        const vzenoAddress = resolveAddress("vZENO", chain)
        const vzeno = IncentivisedVotingLockup__factory.connect(vzenoAddress, signer)
        const tx = await vzeno.claimReward()
        await logTxDetails(tx, "Claim ZENO from old Staking V2 contract")
    })
task("vzeno-claim").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("vzeno-exit", "Withdraw and claim ZENO from old Staking V1 contract")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed, false)
        const chain = getChain(hre)

        const vzenoAddress = resolveAddress("vZENO", chain)
        const vzeno = IncentivisedVotingLockup__factory.connect(vzenoAddress, signer)
        const tx = await vzeno.exit()
        await logTxDetails(tx, "Withdraw and claim ZENO from old Staking V2 contract")
    })
task("vzeno-exit").setAction(async (_, __, runSuper) => {
    await runSuper()
})
