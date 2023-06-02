import { expect } from "chai"
import { Signer } from "ethers"
import { network } from "hardhat"

import { MAX_UINT256, ZERO_ADDRESS } from "@utils/constants"
import { impersonate } from "@utils/fork"
import { simpleToExactAmount } from "@utils/math"
import { assertBNClose } from "@utils/assertions"

import { Chain, zUSD, GUSD, BUSD, cyZUSD } from "tasks/utils/tokens"
import { getChainAddress } from "tasks/utils/networkAddressFactory"

import {
    FeederPool,
    FeederPool__factory,
    IERC20,
    IERC20__factory,
    DudIntegration,
    DudIntegration__factory,
    DudPlatform,
    DudPlatform__factory,
    ICERC20,
    ICERC20__factory,
    InterestValidator,
    InterestValidator__factory,
} from "types/generated"

const chain = Chain.mainnet

const nexusAddress = getChainAddress("Nexus", chain)

const governorAddress = getChainAddress("Governor", chain)
const deployerAddress = getChainAddress("OperationsSigner", chain)
const validatorAddress = getChainAddress("FeederInterestValidator", chain)
const zUSDWhaleAddress = "0x503828976d22510aad0201ac7ec88293211d23da" // Coinbase 2

context("Migrate from integration (Iron Bank) to integration (Dud)", async () => {
    let deployer: Signer
    let governor: Signer
    let zUSDWhale: Signer

    let zusdToken: IERC20
    let cyzusdToken: ICERC20

    let gusdFeederPool: FeederPool
    let busdFeederPool: FeederPool
    let interestValidator: InterestValidator

    let dudIntegration: DudIntegration
    let dudPlatform: DudPlatform

    const setup = async (blockNumber: number) => {
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

        deployer = await impersonate(deployerAddress)
        governor = await impersonate(governorAddress)
        zUSDWhale = await impersonate(zUSDWhaleAddress)

        zusdToken = IERC20__factory.connect(zUSD.address, deployer)
        cyzusdToken = ICERC20__factory.connect(cyZUSD.address, deployer)

        gusdFeederPool = FeederPool__factory.connect(GUSD.feederPool, governor)
        busdFeederPool = FeederPool__factory.connect(BUSD.feederPool, governor)
        interestValidator = InterestValidator__factory.connect(validatorAddress, deployer)

        dudIntegration = DudIntegration__factory.connect("0x30A19c99579cbF7883213C1BdcE0CAF687E4Dd28", deployer)
        dudPlatform = DudPlatform__factory.connect("0x26826c1c3097a4d3b73dCf4eBa22913cb6e5EcA6", deployer)
    }

    before("init setup", async () => {
        await setup(14032362)
    })
    describe.skip("1. FeederPool: zUSD/GUSD", async () => {
        it("should deploy dudPlatform", async () => {
            dudPlatform = await new DudPlatform__factory(deployer).deploy(nexusAddress, zUSD.address)

            // eslint-disable-next-line
            expect(dudPlatform.address).to.be.properAddress

            expect(await dudPlatform.bAsset()).to.equal(zUSD.address)
            expect(await dudPlatform.integration()).to.equal(ZERO_ADDRESS)
        })
        it("should deploy Integration Contract", async () => {
            dudIntegration = await new DudIntegration__factory(deployer).deploy(
                nexusAddress,
                GUSD.feederPool,
                zUSD.address,
                dudPlatform.address,
            )

            expect(dudIntegration.address).not.eq(ZERO_ADDRESS)
            expect(await dudIntegration.lpAddress()).eq(GUSD.feederPool)
            expect(await dudIntegration.bAsset()).eq(zUSD.address)
            expect(await dudIntegration.platform()).eq(dudPlatform.address)

            expect(await zusdToken.allowance(dudIntegration.address, dudPlatform.address)).eq(0)

            await dudIntegration.connect(deployer)["initialize()"]()

            expect(await zusdToken.allowance(dudIntegration.address, dudPlatform.address)).eq(MAX_UINT256)
        })
        it("should attach the dudPlatform", async () => {
            expect(await dudPlatform.integration()).eq(ZERO_ADDRESS)
            await dudPlatform.initialize(dudIntegration.address)
            expect(await dudPlatform.integration()).eq(dudIntegration.address)
        })
        it("should migrate zUSD from the GUSD Feeder Pool", async () => {
            // Collect interest just before to reduce dust
            await interestValidator.collectAndValidateInterest([GUSD.feederPool])
            await interestValidator.connect(governor).collectGovFees([GUSD.feederPool])

            const rawBalBefore = (await gusdFeederPool.getBasset(zUSD.address))[1][1]
            const ironBankBalanceBefore = await zusdToken.balanceOf(cyZUSD.address)

            const ironBankIntegration = (await gusdFeederPool.getBasset(zUSD.address))[0][1]
            const ironBankIntegrationBalance = await zusdToken.balanceOf(ironBankIntegration)

            // eslint-disable-next-line
            expect(ironBankIntegration).to.be.properAddress
            expect(ironBankIntegrationBalance).gt(0)
            expect(ironBankBalanceBefore).gt(0)

            const dudIntegrationBalanceBefore = await zusdToken.balanceOf(dudIntegration.address)
            const dudPlatformBalanceBefore = await zusdToken.balanceOf(dudPlatform.address)
            expect(dudIntegrationBalanceBefore).eq(0)
            expect(dudPlatformBalanceBefore).eq(0)

            const tx = await gusdFeederPool.migrateBassets([zUSD.address], dudIntegration.address)

            const platformBalance = await zusdToken.balanceOf(dudPlatform.address)
            const integrationBalance = await zusdToken.balanceOf(dudIntegration.address)

            await expect(tx).to.emit(gusdFeederPool, "BassetsMigrated").withArgs([zusdToken.address], dudIntegration.address)
            await expect(tx).to.emit(dudPlatform, "PlatformDeposited").withArgs(dudIntegration.address, platformBalance)

            expect(platformBalance).gt(0)
            expect(integrationBalance).gt(0)

            const rawBalAfter = (await gusdFeederPool.getBasset(zUSD.address))[1][1]

            expect(rawBalAfter).eq(rawBalBefore)
            expect(rawBalAfter).eq(platformBalance.add(integrationBalance))

            // some dust will be left ~ 1045074996909 = 0.000001045074996909
            assertBNClose(await cyzusdToken.balanceOf(ironBankIntegration), simpleToExactAmount(0), simpleToExactAmount(1, 13))
        })
        it("should clear the integration to shortcircuit deposits", async () => {
            const balPoolBefore = (await gusdFeederPool.getBasset(zusdToken.address))[1][1]
            const balDudPlatformBefore = await zusdToken.balanceOf(dudPlatform.address)
            const balIntegrationBefore = await zusdToken.balanceOf(dudIntegration.address)

            expect(await dudIntegration.cleared()).eq(false)
            expect(balDudPlatformBefore, "Balance in Dud Platform").gt(0)

            const tx = await dudIntegration.connect(governor)["clear()"]()
            await expect(tx).to.emit(dudIntegration, "PlatformCleared").withArgs(dudPlatform.address, balDudPlatformBefore)

            expect(await dudIntegration.cleared()).eq(true)
            expect(await zusdToken.balanceOf(dudPlatform.address), "Balance in Dud Platform").eq(0)

            expect(await zusdToken.balanceOf(dudIntegration.address), "Balance in Integration").eq(
                balIntegrationBefore.add(balDudPlatformBefore),
            )

            const balPoolAfter = (await gusdFeederPool.getBasset(zusdToken.address))[1][1]
            expect(balPoolAfter).eq(balPoolBefore)
            expect(await zusdToken.balanceOf(dudIntegration.address)).eq(balPoolAfter)
        })
        it("should be able to deposit", async () => {
            const mintAmount = simpleToExactAmount(10000)

            const rawBalBefore = (await gusdFeederPool.getBasset(zusdToken.address))[1][1]
            const balBefore = await zusdToken.balanceOf(dudIntegration.address)

            await zusdToken.connect(zUSDWhale).approve(gusdFeederPool.address, mintAmount)
            await gusdFeederPool.connect(zUSDWhale).mint(zusdToken.address, mintAmount, simpleToExactAmount(1), zUSDWhaleAddress)

            const rawBalAfter = (await gusdFeederPool.getBasset(zusdToken.address))[1][1]
            const balAfter = await zusdToken.balanceOf(dudIntegration.address)

            expect(rawBalAfter).eq(rawBalBefore.add(mintAmount))
            expect(balAfter).eq(balBefore.add(mintAmount))
            expect(rawBalAfter).eq(balAfter)
        })
        it("should be able to withdraw", async () => {
            const whaleBalBefore = await zusdToken.balanceOf(zUSDWhaleAddress)
            const withdrawAmount = await gusdFeederPool.balanceOf(zUSDWhaleAddress)

            const rawBalBefore = (await gusdFeederPool.getBasset(zusdToken.address))[1][1]
            const balBefore = await zusdToken.balanceOf(dudIntegration.address)

            await gusdFeederPool.connect(zUSDWhale).redeem(zusdToken.address, withdrawAmount, simpleToExactAmount(1), zUSDWhaleAddress)

            const rawBalAfter = (await gusdFeederPool.getBasset(zusdToken.address))[1][1]
            const balAfter = await zusdToken.balanceOf(dudIntegration.address)
            const whaleBalAfter = await zusdToken.balanceOf(zUSDWhaleAddress)

            const withdrawn = whaleBalAfter.sub(whaleBalBefore)

            expect(rawBalAfter).eq(rawBalBefore.sub(withdrawn))
            expect(balAfter).eq(balBefore.sub(withdrawn))
            expect(rawBalAfter).eq(balAfter)
        })
    })

    // This doesn't work because
    //      1. Iron Bank has still borrowed amounts
    //      2. Minting is paused on the Iron Bank, liquidity cannot be freed up from third party
    describe("2. FeederPool: zUSD/BUSD", async () => {
        it.skip("should deploy dudPlatform", async () => {
            dudPlatform = await new DudPlatform__factory(deployer).deploy(nexusAddress, zUSD.address)

            // eslint-disable-next-line
            expect(dudPlatform.address).to.be.properAddress

            expect(await dudPlatform.bAsset()).to.equal(zUSD.address)
            expect(await dudPlatform.integration()).to.equal(ZERO_ADDRESS)
        })
        it.skip("should deploy Integration Contract", async () => {
            dudIntegration = await new DudIntegration__factory(deployer).deploy(
                nexusAddress,
                BUSD.feederPool,
                zUSD.address,
                dudPlatform.address,
            )

            expect(dudIntegration.address).not.eq(ZERO_ADDRESS)
            expect(await dudIntegration.lpAddress()).eq(BUSD.feederPool)
            expect(await dudIntegration.bAsset()).eq(zUSD.address)
            expect(await dudIntegration.platform()).eq(dudPlatform.address)

            expect(await zusdToken.allowance(dudIntegration.address, dudPlatform.address)).eq(0)

            await dudIntegration.connect(deployer)["initialize()"]()

            expect(await zusdToken.allowance(dudIntegration.address, dudPlatform.address)).eq(MAX_UINT256)
        })
        it.skip("should attach the dudPlatform", async () => {
            expect(await dudPlatform.integration()).eq(ZERO_ADDRESS)
            await dudPlatform.initialize(dudIntegration.address)
            expect(await dudPlatform.integration()).eq(dudIntegration.address)
        })
        it.skip("Should deposit more into the Iron Bank, otherwise redeem migration will fail", async () => {
            const mintAmount = simpleToExactAmount(10000)

            await zusdToken.connect(zUSDWhale).approve(cyzusdToken.address, mintAmount)
            await cyzusdToken.connect(zUSDWhale).mint(mintAmount)
        })
        it.skip("collect interest and gov fees", async () => {
            // Collect interest just before to reduce dust
            await interestValidator.collectAndValidateInterest([BUSD.feederPool])
            await interestValidator.connect(governor).collectGovFees([BUSD.feederPool])
        })
        it("should migrate zUSD from the BUSD Feeder Pool", async () => {
            const rawBalBefore = (await busdFeederPool.getBasset(zUSD.address))[1][1]
            const ironBankBalanceBefore = await zusdToken.balanceOf(cyZUSD.address)

            const ironBankIntegration = (await busdFeederPool.getBasset(zUSD.address))[0][1]
            const ironBankIntegrationBalance = await zusdToken.balanceOf(ironBankIntegration)

            // eslint-disable-next-line
            expect(ironBankIntegration).to.be.properAddress
            expect(ironBankIntegrationBalance).gt(0)
            expect(ironBankBalanceBefore).gt(0)

            const dudIntegrationBalanceBefore = await zusdToken.balanceOf(dudIntegration.address)
            const dudPlatformBalanceBefore = await zusdToken.balanceOf(dudPlatform.address)
            expect(dudIntegrationBalanceBefore, "integration bal before").eq(0)
            expect(dudPlatformBalanceBefore, "platform bal before").eq(0)

            const tx = await busdFeederPool.migrateBassets([zUSD.address], dudIntegration.address)

            const platformBalanceAfter = await zusdToken.balanceOf(dudPlatform.address)
            const integrationBalanceAfter = await zusdToken.balanceOf(dudIntegration.address)

            await expect(tx).to.emit(busdFeederPool, "BassetsMigrated").withArgs([zusdToken.address], dudIntegration.address)
            await expect(tx).to.emit(dudPlatform, "PlatformDeposited").withArgs(dudIntegration.address, platformBalanceAfter)

            expect(platformBalanceAfter, "platform bal after").gt(0)
            expect(integrationBalanceAfter, "integration bal after").gt(0)

            const rawBalAfter = (await busdFeederPool.getBasset(zUSD.address))[1][1]
            expect(rawBalAfter).eq(rawBalBefore)
            expect(rawBalAfter).eq(platformBalanceAfter.add(integrationBalanceAfter))

            // some dust will be left ~ 160146996313 = 0.000000160146996313
            assertBNClose(await cyzusdToken.balanceOf(ironBankIntegration), simpleToExactAmount(0), simpleToExactAmount(1, 13))
        })
        it("should clear the integration to shortcircuit deposits", async () => {
            const balPoolBefore = (await busdFeederPool.getBasset(zusdToken.address))[1][1]
            const balDudPlatformBefore = await zusdToken.balanceOf(dudPlatform.address)
            const balIntegrationBefore = await zusdToken.balanceOf(dudIntegration.address)

            const clearedBefore = await dudIntegration.cleared()
            expect(clearedBefore).eq(false)
            expect(balDudPlatformBefore, "platform bal before").gt(0)

            const tx = await dudIntegration.connect(governor)["clear()"]()
            await expect(tx).to.emit(dudIntegration, "PlatformCleared").withArgs(dudPlatform.address, balDudPlatformBefore)

            expect(await dudIntegration.cleared()).eq(true)
            expect(await zusdToken.balanceOf(dudPlatform.address), "platform bal after").eq(0)

            expect(await zusdToken.balanceOf(dudIntegration.address), "integration bal after").eq(
                balIntegrationBefore.add(balDudPlatformBefore),
            )

            const balPoolAfter = (await busdFeederPool.getBasset(zusdToken.address))[1][1]
            expect(balPoolAfter).eq(balPoolBefore)
            expect(await zusdToken.balanceOf(dudIntegration.address)).eq(balPoolAfter)
        })
        it("should be able to deposit", async () => {
            const mintAmount = simpleToExactAmount(10000)

            const rawBalBefore = (await busdFeederPool.getBasset(zusdToken.address))[1][1]
            const balBefore = await zusdToken.balanceOf(dudIntegration.address)

            await zusdToken.connect(zUSDWhale).approve(busdFeederPool.address, mintAmount)
            await busdFeederPool.connect(zUSDWhale).mint(zusdToken.address, mintAmount, simpleToExactAmount(1), zUSDWhaleAddress)

            const rawBalAfter = (await busdFeederPool.getBasset(zusdToken.address))[1][1]
            const balAfter = await zusdToken.balanceOf(dudIntegration.address)

            expect(rawBalAfter).eq(rawBalBefore.add(mintAmount))
            expect(balAfter).eq(balBefore.add(mintAmount))
            expect(rawBalAfter).eq(balAfter)
        })
        it("should be able to withdraw", async () => {
            const whaleBalBefore = await zusdToken.balanceOf(zUSDWhaleAddress)
            const withdrawAmount = await busdFeederPool.balanceOf(zUSDWhaleAddress)

            const rawBalBefore = (await busdFeederPool.getBasset(zusdToken.address))[1][1]
            const balBefore = await zusdToken.balanceOf(dudIntegration.address)

            await busdFeederPool.connect(zUSDWhale).redeem(zusdToken.address, withdrawAmount, simpleToExactAmount(1), zUSDWhaleAddress)

            const rawBalAfter = (await busdFeederPool.getBasset(zusdToken.address))[1][1]
            const balAfter = await zusdToken.balanceOf(dudIntegration.address)
            const whaleBalAfter = await zusdToken.balanceOf(zUSDWhaleAddress)

            const withdrawn = whaleBalAfter.sub(whaleBalBefore)

            expect(rawBalAfter).eq(rawBalBefore.sub(withdrawn))
            expect(balAfter).eq(balBefore.sub(withdrawn))
            expect(rawBalAfter).eq(balAfter)
        })
    })
})
