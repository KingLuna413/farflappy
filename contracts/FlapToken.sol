// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title $FLAP — FarFlappy AI Arena token (BEP-20 on BNB Chain)
/// @notice Fixed supply: 1,000,000,000 FLAP (18 decimals). There is NO mint
///         function after the constructor, so supply can never be inflated.
///         The constructor distributes the whole supply once, per tokenomics:
///           40% play / tournament rewards
///           20% liquidity
///           15% team (send to a vesting wallet/contract at deploy time —
///               this contract itself has NO vesting schedule; see README)
///           15% community / airdrop for active legacy players
///           10% treasury
/// @dev Deploy to BSC Testnet (97) first. DO NOT deploy to mainnet (56)
///      without an audit and owner approval. No contract address is claimed
///      in this repo until a real deployment happens.
contract FlapToken is ERC20 {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether; // 1e9 * 10^18

    constructor(
        address rewardPool,
        address liquidity,
        address team,
        address community,
        address treasury
    ) ERC20("FarFlappy AI Arena", "FLAP") {
        require(rewardPool != address(0) && liquidity != address(0) && team != address(0) && community != address(0) && treasury != address(0), "FlapToken: zero address");
        _mint(rewardPool, (TOTAL_SUPPLY * 40) / 100);
        _mint(liquidity, (TOTAL_SUPPLY * 20) / 100);
        _mint(team, (TOTAL_SUPPLY * 15) / 100);
        _mint(community, (TOTAL_SUPPLY * 15) / 100);
        _mint(treasury, (TOTAL_SUPPLY * 10) / 100);
        // 40+20+15+15+10 = 100, so the full fixed supply is distributed here.
    }
}
