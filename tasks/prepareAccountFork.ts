import { subtask, task, types } from "hardhat/config"

import { impersonate } from "@utils/fork"
import { IERC20, IERC20__factory } from "types"
import { simpleToExactAmount } from "@utils/math"
import { getChain, resolveAddress } from "./utils/networkAddressFactory"

const zenoWhaleAddress = "0x3dd46846eed8D147841AE162C8425c08BD8E1b41"

let zenoToken: IERC20

subtask("prepareAccount", "Prepares an Accounts for a local hardhat node for testing.")
    .addParam("address", "Address to prepare", undefined, types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await hre.ethers.getSigners()[0]
        const account = taskArgs.address
        const chain = getChain(hre)

        zenoToken = IERC20__factory.connect(resolveAddress("ZENO", chain), signer)

        const zenoWhale = await impersonate(zenoWhaleAddress)

        // Send ZENO to address from the zenoWhale account
        await zenoToken.connect(zenoWhale).transfer(account, simpleToExactAmount(1000))
    })

task("prepareAccount").setAction(async (_, __, runSuper) => {
    await runSuper()
})
