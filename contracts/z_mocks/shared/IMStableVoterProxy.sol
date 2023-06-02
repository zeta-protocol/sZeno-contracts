// SPDX-License-Identifier: MIT
pragma solidity ^0.8.6;

interface IXZenoVoterProxy {
    function createLock(uint256 _endTime) external;

    function harvestZeno() external;

    function extendLock(uint256 _unlockTime) external;

    function exitLock() external returns (uint256 zenoBalance);

    function changeLockAddress(address _newLock) external;
}
