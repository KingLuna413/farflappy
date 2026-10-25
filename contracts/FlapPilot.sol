// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title FlapPilot — FarFlappy AI Arena pilot NFT (BNB Chain)
/// @notice Tradable ERC721 (NOT soulbound). Owning a Pilot is the ticket into
///         the Agent League and the right to claim $FLAP rewards.
///         Reputation (best verified score, wins, games) lives ON the NFT, so
///         selling the Pilot sells its reputation with it.
/// @notice AGENT ID GATE (only public mint path): only a wallet holding a
///         Binance Agent ID handle ending in ".ai" may mint, via mintAgent().
///         There is NO verified on-chain registry of Binance/SpaceID Agent IDs
///         that this contract can trust directly (do not invent one), so the
///         pattern used by other mint sites is used instead: an off-chain
///         server verifier checks the ".ai" claim and signs a one-time permit;
///         the contract only accepts a mint whose signature recovers to the
///         verifier address. The legacy mint() function is KEPT only as an
///         explicit revert, so old callers get a clear error instead of a
///         silent bypass: "FlapPilot: use mintAgent". It can never mint.
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

    // ---- Agent ID gate ----
    // Server verifier: the ONLY address whose permit signatures mintAgent accepts.
    // Set with setVerifier() after deploy. Keep this key on the server only —
    // never in the repo, never in the browser, never in a NEXT_PUBLIC_ var.
    address public verifier;
    // Sequential nonce per minter. A permit is valid only for the minter's
    // current nonce; mintAgent() increments it, so a permit cannot be replayed.
    mapping(address => uint256) public mintNonce;
    // The ".ai" handle bound to each Pilot at mint time (mintAgent only;
    // legacy mint() always reverts, so it can never create a handle-less Pilot).
    mapping(uint256 => string) public pilotAgentId;

    mapping(uint256 => PilotTraits) public traits;
    mapping(uint256 => PilotReputation) public reputation;
    mapping(address => uint256) public mintedCount;

    // ---- Delegation (v1, simple) ----
    // delegatee = agent allowed to play with this Pilot.
    // delegateShareBps = share of claimed rewards going to the delegatee (0-10000).
    mapping(uint256 => address) public delegatedTo;
    mapping(uint256 => uint256) public delegateShareBps;

    event PilotMinted(uint256 indexed tokenId, address indexed owner, uint8 reaction, uint8 risk, string wingColor);
    event PilotMintedAgent(uint256 indexed tokenId, address indexed owner, string agentIdHandle, uint8 reaction, uint8 risk, string wingColor);
    event VerifierSet(address indexed verifier);
    event PilotDelegated(uint256 indexed tokenId, address indexed delegatee, uint256 delegateShareBps);
    event VerifiedResultRecorded(uint256 indexed tokenId, uint256 score, bool won);

    constructor() ERC721("FlapPilot", "FLAP-PILOT") Ownable(msg.sender) {}

    function setArena(address _arena) external onlyOwner {
        arena = _arena;
    }

    function setVerifier(address _verifier) external onlyOwner {
        require(_verifier != address(0), "FlapPilot: zero verifier");
        verifier = _verifier;
        emit VerifierSet(_verifier);
    }

    /// @notice Format check for a ".ai" Agent ID handle, enforced on-chain.
    ///         Prefix: at least 3 chars, lowercase a-z / 0-9 / '-', not
    ///         starting or ending with '-'. Suffix: exactly ".ai".
    function isValidAgentIdHandle(string memory handle) public pure returns (bool) {
        bytes memory b = bytes(handle);
        if (b.length < 6 || b.length > 64) return false; // min "abc.ai"
        if (b[b.length - 3] != bytes1('.') || b[b.length - 2] != bytes1('a') || b[b.length - 1] != bytes1('i')) return false;
        uint256 prefixLen = b.length - 3;
        if (prefixLen < 3) return false;
        if (b[0] == bytes1('-') || b[prefixLen - 1] == bytes1('-')) return false;
        for (uint256 i = 0; i < prefixLen; i++) {
            bytes1 c = b[i];
            bool ok = (c >= bytes1('a') && c <= bytes1('z')) ||
                (c >= bytes1('0') && c <= bytes1('9')) || c == bytes1('-');
            if (!ok) return false;
        }
        return true;
    }

    function _doMint(uint8 reaction, uint8 risk, string memory wingColor) internal returns (uint256 tokenId) {
        require(nextTokenId <= MAX_SUPPLY, "FlapPilot: sold out");
        require(msg.value >= MINT_PRICE, "FlapPilot: insufficient BNB");
        require(mintedCount[msg.sender] < MAX_PER_WALLET, "FlapPilot: wallet limit");
        require(reaction <= 100 && risk <= 100, "FlapPilot: trait out of range");
        tokenId = nextTokenId;
        nextTokenId++;
        mintedCount[msg.sender]++;
        traits[tokenId] = PilotTraits(reaction, risk, wingColor);
        _safeMint(msg.sender, tokenId);
    }

    /// @notice Legacy mint — CLOSED. It is kept only so old callers get an
    ///         explicit error instead of silently minting around the ".ai"
    ///         gate. It never mints, never takes BNB, and never emits
    ///         PilotMinted. The only public mint path is mintAgent().
    function mint(uint8, uint8, string calldata) external payable returns (uint256) {
        revert("FlapPilot: use mintAgent");
    }

    /// @notice PUBLIC mint path: only for Agent ID wallets.
    /// @dev The verifier signs, off-chain, the Ethereum-signed message of
    ///      keccak256(abi.encode(minter, agentIdHandle, reaction, risk,
    ///      wingColor, nonce)) where nonce is the minter's current
    ///      mintNonce (read on-chain by the permit server before signing).
    ///      must verify the ".ai" claim BEFORE signing (see /api/mint/permit
    ///      and contracts/README.md); this contract only verifies format,
    ///      signature and nonce — it cannot itself prove a Binance claim.
    function mintAgent(
        uint8 reaction,
        uint8 risk,
        string calldata wingColor,
        string calldata agentIdHandle,
        bytes calldata signature
    ) external payable returns (uint256 tokenId) {
        require(verifier != address(0), "FlapPilot: verifier not set");
        require(isValidAgentIdHandle(agentIdHandle), "FlapPilot: invalid .ai handle");
        uint256 nonce = mintNonce[msg.sender];
        bytes32 digest = keccak256(abi.encode(msg.sender, agentIdHandle, reaction, risk, wingColor, nonce));
        address recovered = ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(digest), signature);
        require(recovered == verifier, "FlapPilot: bad permit signature");
        mintNonce[msg.sender]++;
        tokenId = _doMint(reaction, risk, wingColor);
        pilotAgentId[tokenId] = agentIdHandle;
        emit PilotMintedAgent(tokenId, msg.sender, agentIdHandle, reaction, risk, wingColor);
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
