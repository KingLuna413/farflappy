// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title FlapPilot — FarFlappy AI Arena pilot NFT (BNB Chain)
/// @notice Tradable ERC721 (NOT soulbound). Owning a Pilot is the ticket into
///         the Agent League and the right to claim $FLAP rewards.
///         Reputation (best verified score, wins, games) lives ON the NFT, so
///         selling the Pilot sells its reputation with it.
/// @dev Requires OpenZeppelin Contracts ^5. Deploy to BSC Testnet (97) first.
///      DO NOT deploy to BNB mainnet (56) without an audit and owner approval.
contract FlapPilot is ERC721, Ownable {
    // ---- Easily-changed launch constants (see README / contracts/README.md) ----
    uint256 public constant MAX_SUPPLY = 10_000;
    uint256 public constant MINT_PRICE = 0.01 ether; // BNB
    uint256 public constant MAX_PER_WALLET = 5;

    struct PilotTraits {
        uint8 reaction; // 0-100, play style: reaction speed
        uint8 risk; // 0-100, play style: risk appetite
        string wingColor; // cosmetic, e.g. "gold", "violet"
    }

    struct PilotReputation {
        uint256 bestVerifiedScore;
        uint256 wins;
        uint256 gamesPlayed;
    }

    uint256 public nextTokenId = 1;
    address public arena; // FlapArena, the only contract allowed to record results

    mapping(uint256 => PilotTraits) public traits;
    mapping(uint256 => PilotReputation) public reputation;
    mapping(address => uint256) public mintedCount;

    // ---- Delegation (v1, simple) ----
    // delegatee = agent allowed to play with this Pilot.
    // delegateShareBps = share of claimed rewards going to the delegatee (0-10000).
    mapping(uint256 => address) public delegatedTo;
    mapping(uint256 => uint256) public delegateShareBps;

    event PilotMinted(uint256 indexed tokenId, address indexed owner, uint8 reaction, uint8 risk, string wingColor);
    event PilotDelegated(uint256 indexed tokenId, address indexed delegatee, uint256 delegateShareBps);
    event VerifiedResultRecorded(uint256 indexed tokenId, uint256 score, bool won);

    constructor() ERC721("FlapPilot", "FLAP-PILOT") Ownable(msg.sender) {}

    function setArena(address _arena) external onlyOwner {
        arena = _arena;
    }

    function mint(uint8 reaction, uint8 risk, string calldata wingColor) external payable returns (uint256 tokenId) {
        require(nextTokenId <= MAX_SUPPLY, "FlapPilot: sold out");
        require(msg.value >= MINT_PRICE, "FlapPilot: insufficient BNB");
        require(mintedCount[msg.sender] < MAX_PER_WALLET, "FlapPilot: wallet limit");
        require(reaction <= 100 && risk <= 100, "FlapPilot: trait out of range");

        tokenId = nextTokenId;
        nextTokenId++;
        mintedCount[msg.sender]++;

        traits[tokenId] = PilotTraits(reaction, risk, wingColor);
        _safeMint(msg.sender, tokenId);
        emit PilotMinted(tokenId, msg.sender, reaction, risk, wingColor);
    }

    /// @notice Owner delegates a Pilot to another agent. Reputation stays on the NFT.
    function delegatePilot(uint256 tokenId, address delegatee, uint256 _delegateShareBps) external {
        require(ownerOf(tokenId) == msg.sender, "FlapPilot: not owner");
        require(_delegateShareBps <= 10_000, "FlapPilot: share > 100%");
        delegatedTo[tokenId] = delegatee;
        delegateShareBps[tokenId] = _delegateShareBps;
        emit PilotDelegated(tokenId, delegatee, _delegateShareBps);
    }

    function undelegatePilot(uint256 tokenId) external {
        require(ownerOf(tokenId) == msg.sender, "FlapPilot: not owner");
        delegatedTo[tokenId] = address(0);
        delegateShareBps[tokenId] = 0;
        emit PilotDelegated(tokenId, address(0), 0);
    }

    /// @notice Only FlapArena may record a verified result (after replay verification).
    function recordVerifiedResult(uint256 tokenId, uint256 score, bool won) external {
        require(msg.sender == arena, "FlapPilot: only arena");
        require(_ownerOf(tokenId) != address(0), "FlapPilot: no such pilot");
        PilotReputation storage rep = reputation[tokenId];
        rep.gamesPlayed++;
        if (score > rep.bestVerifiedScore) rep.bestVerifiedScore = score;
        if (won) rep.wins++;
        emit VerifiedResultRecorded(tokenId, score, won);
    }

    function withdraw() external onlyOwner {
        (bool ok, ) = owner().call{value: address(this).balance}("");
        require(ok, "FlapPilot: withdraw failed");
    }
}
