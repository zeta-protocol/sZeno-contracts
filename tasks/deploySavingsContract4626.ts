import "ts-node/register"
import "tsconfig-paths/register"
import { DEAD_ADDRESS } from "@utils/constants"
import { task, types } from "hardhat/config"
import { DelayedProxyAdmin__factory } from "types/generated"
// Polygon izUSD Contract
import { SavingsContractIzusdPolygon22 } from "types/generated/SavingsContractIzusdPolygon22"
import { SavingsContractIzusdPolygon22__factory } from "types/generated/factories/SavingsContractIzusdPolygon22__factory"
// Mainnet imBTC Contract
import { SavingsContractImbtcMainnet22__factory } from "types/generated/factories/SavingsContractImbtcMainnet22__factory"
import { SavingsContractImbtcMainnet22 } from "types/generated/SavingsContractImbtcMainnet22"
// Mainnet izUSD Contract
import { SavingsContractIzusdMainnet22__factory } from "types/generated/factories/SavingsContractIzusdMainnet22__factory"
import { SavingsContractIzusdMainnet22 } from "types/generated/SavingsContractIzusdMainnet22"

import { deployContract } from "./utils/deploy-utils"
import { getSigner } from "./utils/signerFactory"
import { getChain, resolveAddress, getChainAddress } from "./utils/networkAddressFactory"
import { Chain } from "./utils/tokens"
import { verifyEtherscan } from "./utils/etherscan"

task("upgrade-izusd-polygon", "Upgrade Polygon izUSD save contract izUSD")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        if (chain !== Chain.polygon) throw Error("Task can only run against polygon or a polygon fork")

        const zusdAddress = resolveAddress("zUSD", chain)
        const izusdAddress = resolveAddress("zUSD", chain, "savings")
        const delayedAdminAddress = getChainAddress("DelayedProxyAdmin", chain)
        const nexusAddress = getChainAddress("Nexus", chain)
        const unwrapperAddress = getChainAddress("Unwrapper", chain)
        const constructorArguments = [nexusAddress, zusdAddress, unwrapperAddress]

        // Deploy step 1 - Save Contract
        const saveContractImpl = await deployContract<SavingsContractIzusdPolygon22>(
            new SavingsContractIzusdPolygon22__factory(signer),
            "xZeno: zUSD Savings Contract (izUSD)",
            constructorArguments,
        )
        await verifyEtherscan(hre, {
            address: saveContractImpl.address,
            contract: "contracts/legacy-upgraded/izusd-polygon-22.sol:SavingsContract_izusd_polygon_22",
            constructorArguments,
        })

        // Deploy step 2 - Propose upgrade
        // Update the Save Contract proxy to point to the new implementation using the delayed proxy admin
        const delayedProxyAdmin = DelayedProxyAdmin__factory.connect(delayedAdminAddress, signer)

        // Update the  proxy to point to the new implementation using the delayed proxy admin
        const upgradeData = []
        const proposeUpgradeData = delayedProxyAdmin.interface.encodeFunctionData("proposeUpgrade", [
            izusdAddress,
            saveContractImpl.address,
            upgradeData,
        ])
        console.log(`\ndelayedProxyAdmin.proposeUpgrade to ${delayedAdminAddress}, data:\n${proposeUpgradeData}`)
    })

task("upgrade-izusd-mainnet", "Upgrade Mainnet izUSD save contract izUSD")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        if (chain !== Chain.mainnet) throw Error("Task can only run against mainnet or a mainnet fork")

        const izusdAddress = resolveAddress("zUSD", chain, "savings")
        const delayedAdminAddress = getChainAddress("DelayedProxyAdmin", chain)
        const unwrapperAddress = getChainAddress("Unwrapper", chain)
        const constructorArguments = []

        // Deploy step 1 -  Save Contract
        const saveContractImpl = await deployContract<SavingsContractIzusdMainnet22>(
            new SavingsContractIzusdMainnet22__factory(signer),
            "xZeno: zUSD Savings Contract (izUSD)",
            constructorArguments,
        )
        // Validate the unwrapper is set as constant on the save contract
        if ((await saveContractImpl.unwrapper()) !== unwrapperAddress || unwrapperAddress === DEAD_ADDRESS)
            throw Error("Unwrapper address not set on save contract")
        await verifyEtherscan(hre, {
            address: saveContractImpl.address,
            contract: "contracts/legacy-upgraded/izusd-mainnet-22.sol:SavingsContract_izusd_mainnet_22",
            constructorArguments,
        })

        // Deploy step 2 - Propose upgrade
        // Update the Save Contract proxy to point to the new implementation using the delayed proxy admin
        const delayedProxyAdmin = DelayedProxyAdmin__factory.connect(delayedAdminAddress, signer)

        // Update the  proxy to point to the new implementation using the delayed proxy admin
        const upgradeData = []
        const proposeUpgradeData = delayedProxyAdmin.interface.encodeFunctionData("proposeUpgrade", [
            izusdAddress,
            saveContractImpl.address,
            upgradeData,
        ])
        console.log(`\ndelayedProxyAdmin.proposeUpgrade to ${delayedAdminAddress}, data:\n${proposeUpgradeData}`)
    })

task("upgrade-imbtc-mainnet", "Upgrade Mainnet imBTC save contract imBTC")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        if (chain !== Chain.mainnet) throw Error("Task can only run against mainnet or a mainnet fork")

        const mbtcAddress = resolveAddress("mBTC", chain)
        const imbtcAddress = resolveAddress("mBTC", chain, "savings")
        const delayedAdminAddress = getChainAddress("DelayedProxyAdmin", chain)
        const nexusAddress = getChainAddress("Nexus", chain)
        const unwrapperAddress = getChainAddress("Unwrapper", chain)

        const constructorArguments = [nexusAddress, mbtcAddress, unwrapperAddress]

        // Deploy step 1 -  Save Contract
        const saveContractImpl = await deployContract<SavingsContractImbtcMainnet22>(
            new SavingsContractImbtcMainnet22__factory(signer),
            "xZeno: mBTC Savings Contract (imBTC)",
            constructorArguments,
        )
        await verifyEtherscan(hre, {
            address: saveContractImpl.address,
            contract: "contracts/legacy-upgraded/imbtc-mainnet-22.sol:SavingsContract_imbtc_mainnet_22",
            constructorArguments,
        })

        // Deploy step 2 - Propose upgrade
        // Update the Save Contract proxy to point to the new implementation using the delayed proxy admin
        const delayedProxyAdmin = DelayedProxyAdmin__factory.connect(delayedAdminAddress, signer)

        // Update the  proxy to point to the new implementation using the delayed proxy admin
        const upgradeData = []
        const proposeUpgradeData = delayedProxyAdmin.interface.encodeFunctionData("proposeUpgrade", [
            imbtcAddress,
            saveContractImpl.address,
            upgradeData,
        ])
        console.log(`\ndelayedProxyAdmin.proposeUpgrade to ${delayedAdminAddress}, data:\n${proposeUpgradeData}`)
    })
module.exports = {}
