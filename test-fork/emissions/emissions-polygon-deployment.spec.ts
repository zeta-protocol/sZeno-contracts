import { ethers, network } from "hardhat"

import { impersonate } from "@utils/fork"
import { Signer } from "ethers"
import { resolveAddress } from "tasks/utils/networkAddressFactory"
import { Chain, ZENO, PBAL, PFRAX, PZENO, PzUSD } from "tasks/utils/tokens"
import {
    BalRewardsForwarder,
    BalRewardsForwarder__factory,
    IERC20,
    IERC20__factory,
    InitializableRewardsDistributionRecipient,
    InitializableRewardsDistributionRecipient__factory,
    IRewardsDistributionRecipient,
    IStateReceiver,
    IStateReceiver__factory,
    L2BridgeRecipient,
    L2EmissionsController,
    L2EmissionsController__factory,
} from "types/generated"
import { keccak256 } from "@ethersproject/keccak256"
import { toUtf8Bytes } from "ethers/lib/utils"
import { BN, simpleToExactAmount, ZERO_ADDRESS } from "index"
import { expect } from "chai"
import { deployL2BridgeRecipient } from "tasks/utils/rewardsUtils"

const keeperKey = keccak256(toUtf8Bytes("Keeper"))
console.log(`Keeper ${keeperKey}`)

const chain = Chain.polygon
const abiCoder = ethers.utils.defaultAbiCoder

context("Fork test Emissions Controller on polygon", () => {
    let ops: Signer
    let governor: Signer
    let stateSyncer: Signer
    let emissionsController: L2EmissionsController
    let zeno: IERC20
    let childChainManager: IStateReceiver
    let zusdVault: InitializableRewardsDistributionRecipient
    let balRewardsForwarder: BalRewardsForwarder
    let nexusAddress: string

    const setup = async (blockNumber?: number) => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber,
                    },
                },
            ],
        })
        ops = await impersonate(resolveAddress("OperationsSigner", chain))
        governor = await impersonate(resolveAddress("Governor", chain))
        stateSyncer = await impersonate("0x0000000000000000000000000000000000001001")
        nexusAddress = await resolveAddress("Nexus", chain)

        emissionsController = L2EmissionsController__factory.connect(resolveAddress("EmissionsController", chain), ops)
        zeno = IERC20__factory.connect(PZENO.address, ops)
        zusdVault = InitializableRewardsDistributionRecipient__factory.connect(PzUSD.vault, governor)

        childChainManager = IStateReceiver__factory.connect(resolveAddress("PolygonChildChainManager", chain), stateSyncer)
    }

    const deposit = async (bridgeRecipient: string, amount: BN) => {
        const amountData = abiCoder.encode(["uint256"], [amount])
        const syncData = abiCoder.encode(["address", "address", "bytes"], [bridgeRecipient, ZENO.address, amountData])
        const data = abiCoder.encode(["bytes32", "bytes"], [keccak256(toUtf8Bytes("DEPOSIT")), syncData])
        await childChainManager.onStateReceive(1, data)
    }

    before(async () => {
        // Fork from the latest block
        await setup()
    })

    describe("zUSD Vault", () => {
        const depositAmount = simpleToExactAmount(20000)
        before(async () => {
            await zusdVault.setRewardsDistribution(emissionsController.address)
        })
        it("Deposit 20k to zUSD bridge recipient", async () => {
            expect(await zeno.balanceOf(PzUSD.bridgeRecipient), "bridge recipient bal before").to.eq(0)

            await deposit(PzUSD.bridgeRecipient, depositAmount)

            expect(await zeno.balanceOf(PzUSD.bridgeRecipient), "bridge recipient bal after").to.eq(depositAmount)
        })
        it("Distribute rewards", async () => {
            const zenoBalBefore = await zeno.balanceOf(PzUSD.vault)
            expect(zenoBalBefore, "vault bal before").to.gt(0)

            await emissionsController.distributeRewards([PzUSD.vault])

            const zenoBalAfter = await zeno.balanceOf(PzUSD.vault)
            expect(zenoBalAfter.sub(zenoBalBefore), "vault bal change").to.eq(depositAmount)
        })
    })
    describe("FRAX Farm", () => {
        const depositAmount = simpleToExactAmount(10000)

        it("Deposit 10k to FRAX Farm", async () => {
            const zenoBalBefore = await zeno.balanceOf(PFRAX.bridgeRecipient)
            expect(zenoBalBefore, "FRAX Farm bal before").to.gt(0)

            await deposit(PFRAX.bridgeRecipient, depositAmount)

            const zenoBalAfter = await zeno.balanceOf(PFRAX.bridgeRecipient)
            expect(zenoBalAfter.sub(zenoBalBefore), "FRAX Farm bal change").to.eq(depositAmount)
        })
    })
    describe("Balancer Pool", () => {
        // 1.-Deploy new L2BridgeRecipient
        // 2.-Deploy new BalRewardsForwarder
        // 3.-EmissionsController Add Recipient(L2BridgeRecipient, BalRewardsForwarder)
        // 4.-Distribute Rewards (L2BridgeRecipient=>BalRewardsForwarder=>BalancerStreamer)
        const depositAmount = simpleToExactAmount(15000)

        let forwarderEndRecipient: string
        let bridgeRecipient: L2BridgeRecipient
        let endRecipient: IRewardsDistributionRecipient
        before("deploy recipients", async () => {
            forwarderEndRecipient = resolveAddress("BpZENOStreamer", chain)
            // Deploy a new bridge recipient
            bridgeRecipient = await deployL2BridgeRecipient(governor, zeno.address, emissionsController.address)
            // Deploy a new end recipient(Forwarder)
            balRewardsForwarder = await new BalRewardsForwarder__factory(governor).deploy(nexusAddress, zeno.address)
            await balRewardsForwarder.initialize(emissionsController.address, forwarderEndRecipient)
            endRecipient = balRewardsForwarder as IRewardsDistributionRecipient
        })
        it("Deposit 15k to Stream Forwarder", async () => {
            expect(await zeno.balanceOf(bridgeRecipient.address), "Stream bal before").to.eq(0)
            await deposit(bridgeRecipient.address, depositAmount)
            expect(await zeno.balanceOf(bridgeRecipient.address), "Stream bal after").to.eq(depositAmount)
        })
        it("Add recipient", async () => {
            expect(await emissionsController.recipientMap(bridgeRecipient.address), "Recipient not set").to.eq(ZERO_ADDRESS)
            await emissionsController.connect(governor).addRecipient(bridgeRecipient.address, endRecipient.address)
            expect(await emissionsController.recipientMap(endRecipient.address), "Recipient set").to.eq(bridgeRecipient.address)
        })
        it("Distribute rewards", async () => {
            const zenoBalBefore = await zeno.balanceOf(bridgeRecipient.address)
            const zenoForwarderBalBefore = await zeno.balanceOf(forwarderEndRecipient)

            expect(zenoBalBefore, "forwarder bal before").to.gt(0)
            expect(zenoForwarderBalBefore, "streamer bal before").to.eq(0)

            // AT  BLOCK , balancer has not add yet the ZENO reward on polygon gauge
            await expect(emissionsController.distributeRewards([endRecipient.address])).to.be.revertedWith("Invalid token or no new reward")

            // *******NOTE BEGIN************//
            // If balancer team adds the distributor and the token into the gauge this is the expected behavior
            // await expect(tx).to.emit(balRewardsForwarder, "RewardsReceived").withArgs(depositAmount)
            // const zenoBalAfter = await zeno.balanceOf(bridgeRecipient.address)
            // const zenoForwarderBalAfter = await zeno.balanceOf(forwarderEndRecipient)
            // expect(zenoBalAfter.sub(zenoBalBefore), "forwarder bal change").to.eq(depositAmount)
            // expect(zenoForwarderBalAfter.sub(zenoForwarderBalBefore), "streamer bal change").to.eq(depositAmount)
            // ******** NOTE END***********//
        })
    })
})
