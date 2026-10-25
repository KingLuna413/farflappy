// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IFlapPilot {
    function ownerOf(uint256 tokenId) external view returns (address);
    function delegatedTo(uint256 tokenId) external view returns (address);
    function delegateShareBps(uint256 tokenId) external view returns (uint256);
    function recordVerifiedResult(uint256 tokenId, uint256 score, bool won) external;
}

/// @title FlapArena — tournament vault + verified-score reward claims + Pilot staking
/// @notice Rewards are ONLY accrued from verified replays. The off-chain API
///         (app/api/agent/replay) verifies a replay first, then the trusted
///         verifier calls recordVerifiedScore here. A raw score submitted
///         without a verified replay can never accrue rewards in this contract.
/// @dev v1, simple. Deploy to BSC Testnet (97) first. No audit yet.
contract FlapArena is Ownable, IERC721Receiver {
    IERC20 public immutable flapToken;
    IFlapPilot public immutable pilot;

    address public verifier; // backend / API signer address, set by owner
    uint256 public constant REWARD_PER_100_POINTS = 1 ether; // 1 FLAP per 100 points

    mapping(bytes32 => bool) public replayHashUsed; // one claim per replay hash
    mapping(uint256 => uint256) public pendingRewards; // pilotId -> FLAP (wei)
    mapping(uint256 => bool) public staked; // pilotId -> staked in arena
    mapping(uint256 => address) public staker; // pilotId -> address that staked it

    event VerifiedScoreRecorded(uint256 indexed pilotId, address indexed player, uint256 score, bytes32 replayHash);
    event RewardClaimed(uint256 indexed pilotId, address indexed owner, address indexed delegatee, uint256 ownerAmount, uint256 delegateAmount);
    event PrizeDistributed(address indexed winner, uint256 amount);
    event PilotStaked(uint256 indexed pilotId, address indexed owner);
    event PilotUnstaked(uint256 indexed pilotId, address indexed owner);

    constructor(address _flapToken, address _pilot, address _verifier) Ownable(msg.sender) {
        require(_flapToken != address(0) && _pilot != address(0), "FlapArena: zero address");
        flapToken = IERC20(_flapToken);
        pilot = IFlapPilot(_pilot);
        verifier = _verifier;
    }

    function setVerifier(address _verifier) external onlyOwner {
        verifier = _verifier;
    }

    /// @notice Fund the reward pool. Owner must approve FLAP to this contract first.
    function fundRewards(uint256 amount) external {
        require(flapToken.transferFrom(msg.sender, address(this), amount), "FlapArena: fund failed");
    }

    /// @notice Called ONLY by the verifier after off-chain replay verification.
    function recordVerifiedScore(uint256 pilotId, address player, uint256 score, bytes32 replayHash, bool won) external {
        require(msg.sender == verifier, "FlapArena: only verifier");
        require(!replayHashUsed[replayHash], "FlapArena: replay already used");
        replayHashUsed[replayHash] = true;
        pendingRewards[pilotId] += (score / 100) * REWARD_PER_100_POINTS;
        pilot.recordVerifiedResult(pilotId, score, won);
        emit VerifiedScoreRecorded(pilotId, player, score, replayHash);
    }

    /// @notice Pilot owner (or delegatee, if delegated) claims accrued rewards.
    ///         Split follows the Pilot's on-chain delegation setting.
    function claimReward(uint256 pilotId) external {
        address pilotOwner = pilot.ownerOf(pilotId);
        address delegatee = pilot.delegatedTo(pilotId);
        uint256 shareBps = pilot.delegateShareBps(pilotId);
        require(msg.sender == pilotOwner || msg.sender == delegatee, "FlapArena: not owner/delegatee");
        uint256 amount = pendingRewards[pilotId];
        require(amount > 0, "FlapArena: nothing to claim");
        pendingRewards[pilotId] = 0;

        uint256 delegateAmount = (amount * shareBps) / 10_000;
        uint256 ownerAmount = amount - delegateAmount;
        if (delegateAmount > 0 && delegatee != address(0)) {
            require(flapToken.transfer(delegatee, delegateAmount), "FlapArena: delegate transfer failed");
        } else {
            ownerAmount = amount;
            delegateAmount = 0;
        }
        require(flapToken.transfer(pilotOwner, ownerAmount), "FlapArena: owner transfer failed");
        emit RewardClaimed(pilotId, pilotOwner, delegatee, ownerAmount, delegateAmount);
    }

    /// @notice Tournament prize payout from the arena balance. Owner only, v1.
    function distributePrize(address[] calldata winners, uint256[] calldata amounts) external onlyOwner {
        require(winners.length == amounts.length, "FlapArena: length mismatch");
        for (uint256 i = 0; i < winners.length; i++) {
            require(flapToken.transfer(winners[i], amounts[i]), "FlapArena: prize transfer failed");
            emit PrizeDistributed(winners[i], amounts[i]);
        }
    }

    /// @notice Simple Pilot staking: caller must approve this contract for
    ///         the Pilot first; custody moves to the arena while staked.
    function stakePilot(uint256 pilotId) external {
        require(pilot.ownerOf(pilotId) == msg.sender, "FlapArena: not owner");
        require(!staked[pilotId], "FlapArena: already staked");
        IERC721(address(pilot)).safeTransferFrom(msg.sender, address(this), pilotId);
        staked[pilotId] = true;
        staker[pilotId] = msg.sender;
        emit PilotStaked(pilotId, msg.sender);
    }

    function unstakePilot(uint256 pilotId) external {
        require(staked[pilotId], "FlapArena: not staked");
        require(staker[pilotId] == msg.sender, "FlapArena: not staker");
        staked[pilotId] = false;
        staker[pilotId] = address(0);
        IERC721(address(pilot)).safeTransferFrom(address(this), msg.sender, pilotId);
        emit PilotUnstaked(pilotId, msg.sender);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
