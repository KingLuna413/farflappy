# FarFlappy AI Arena — Contracts

**STATUS: CODE ONLY. NOT DEPLOYED. NOT AUDITED.**

No contract address in this repo is real until a deployment actually happens.
Do not send BNB to any address copied from an unverified post.

## Contracts

| Contract | File | Purpose |
| --- | --- | --- |
| FlapPilot | `FlapPilot.sol` | ERC721, tradable (not soulbound). Ticket to Agent League. Traits + reputation live on the NFT. Mint: max supply 10,000, price 0.01 BNB, max 5 per wallet. |
| FlapToken ($FLAP) | `FlapToken.sol` | ERC20 / BEP-20, fixed supply 1,000,000,000, no mint after constructor. Distribution in constructor: 40% rewards, 20% liquidity, 15% team, 15% community/airdrop, 10% treasury. |
| FlapArena | `FlapArena.sol` | Tournament vault + verified-score reward claims + simple Pilot staking + delegation split on claim. Only the trusted verifier (set by owner) may accrue rewards, and only after off-chain replay verification. |

## Compile (concept, BSC Testnet first)

These contracts need OpenZeppelin Contracts ^5. They are NOT in this repo's
`package.json` yet, so install the toolchain separately before compiling:

```bash
npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox
npm install @openzeppelin/contracts
npx hardhat compile
```

Deploy order (BSC Testnet, chain 97, testnet BNB only):

1. `FlapToken` — pass reward / liquidity / team / community / treasury addresses.
2. `FlapPilot`
3. `FlapArena` — pass token address, pilot address, verifier address.
4. `FlapPilot.setArena(arenaAddress)` — so the arena can record verified results.
5. Fund the arena: approve $FLAP to the arena, then `fundRewards(amount)`.
6. Copy the three deployed addresses into `.env` as
   `NEXT_PUBLIC_FLAP_PILOT_ADDRESS`, `NEXT_PUBLIC_FLAP_TOKEN_ADDRESS`,
   `NEXT_PUBLIC_FLAP_ARENA_ADDRESS`. Never commit a private key.

## Warnings — read before any mainnet step

- **DO NOT deploy to BNB mainnet (56) without an audit and explicit owner approval.**
- Team vesting is NOT enforced in `FlapToken` v1: the team share goes to
  whatever address is passed at deploy time. Use a vesting wallet/contract
  for that address if the team share must be time-locked.
- `FlapArena` trusts a single verifier address. If that key is compromised,
  fake verified scores can accrue rewards. Rotate it with `setVerifier`
  and consider a multisig / threshold verifier before production.
- Replay physics in `lib/replay.ts` is v1 (pipes only). It MUST be aligned
  exactly with `components/game/GameEngine.tsx` (coins, items, tournament
  speed tiers, full PRNG sequence) before rewards are paid on mainnet.
