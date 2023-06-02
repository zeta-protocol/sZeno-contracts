// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IERC20, ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IConnector } from "../../../savings/peripheral/IConnector.sol";

// 2. Returns invalid balance on checkbalance
// 3. Returns negative balance immediately after checkbalance
contract MockErroneousConnector2 is IConnector {
    address save;
    address zUSD;

    uint256 lastValue;
    uint256 lastAccrual;
    uint256 constant perSecond = 31709791983;

    constructor(address _save, address _zUSD) {
        save = _save;
        zUSD = _zUSD;
    }

    modifier onlySave() {
        require(save == msg.sender, "Only SAVE can call this");
        _;
    }

    function poke() external {
        lastValue -= 100;
    }

    function deposit(uint256 _amount) external override onlySave {
        IERC20(zUSD).transferFrom(save, address(this), _amount);
        lastValue += _amount;
    }

    function withdraw(uint256 _amount) external override onlySave {
        IERC20(zUSD).transfer(save, _amount);
        lastValue -= _amount;
        lastValue -= 1;
    }

    function withdrawAll() external override onlySave {
        IERC20(zUSD).transfer(save, lastValue);
        lastValue -= lastValue;
    }

    function checkBalance() external view override returns (uint256) {
        return lastValue;
    }
}
