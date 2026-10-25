# FarFlappy AI Arena — Contracts

**STATUS: CODE ONLY. NOT DEPLOYED. NOT AUDITED.**

No contract address in this repo is real until a deployment actually happens.
Do not send BNB to any address copied from an unverified post.

## Contracts

| Contract | File | Purpose |
| --- | --- | --- |
| FlapPilot | `FlapPilot.sol` | ERC721, tradable (not soulbound). Ticket to Agent League. Traits + reputation live on the NFT. Mint: max supply 10,000, price 0.01 BNB, max 5 per wallet. PUBLIC mint is `mintAgent()` — gated to Binance Agent ID `.ai` handles via a server-verifier permit signature (see below). |
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
5. `FlapPilot.setVerifier(verifierAddress)` — the server address whose
   signatures `mintAgent()` accepts. This key stays on the server only:
   set `MINT_VERIFIER_PRIVATE_KEY` in server env (no `NEXT_PUBLIC_`
   prefix, never committed). If `MINT_VERIFIER_PRIVATE_KEY` is unset,
   `/api/mint/permit` returns 503 and issues no permit.
6. Fund the arena: approve $FLAP to the arena, then `fundRewards(amount)`.
7. Copy the three deployed addresses into `.env` as
   `NEXT_PUBLIC_FLAP_PILOT_ADDRESS`, `NEXT_PUBLIC_FLAP_TOKEN_ADDRESS`,
   `NEXT_PUBLIC_FLAP_ARENA_ADDRESS`. Never commit a private key.

## Agent ID gate — how mintAgent works

Public mint flow (same pattern as other mint sites, e.g. Ptah / Four.meme):

1. User claims a `.ai` handle in the Binance App (Web3 wallet -> Agent ID).
2. User connects that wallet on `/mint` and enters the same handle.
3. User signs a challenge message with that wallet (see
   `lib/agentIdVerify.ts` `buildClaimChallengeMessage`). This proves
   WALLET OWNERSHIP only — it does not prove `.ai` ownership.
4. The server verifies the `.ai` claim, fail-closed, via
   `lib/agentIdVerify.ts` `verifyAgentIdClaim()`:
   - Production: a deployer-configured resolver
     (`AGENT_ID_RESOLVER_URL`, with its own auth) must resolve the
     handle to exactly this wallet, as an EOA, not a fallback address.
   - Testnet only (chain 97): an exact `wallet:handle` pair in
     `AGENT_ID_TESTNET_ALLOWLIST`. This proves nothing about a
     Binance claim and is rejected outright for chain 56.
   - No resolver configured -> verified=false, no permit, ever.
5. Only then does the server read the wallet's current `mintNonce`
   from FlapPilot on-chain and sign:
   `keccak256(abi.encode(wallet, handle, reaction, risk, wingColor, nonce))`
   as raw bytes with the Ethereum signed-message prefix (viem
   `signMessage({ message: { raw: digest } })`).
6. The user calls `mintAgent(reaction, risk, wingColor, handle, signature)`
   with 0.01 BNB. The contract checks the `.ai` format, recovers the
   signer and requires it to equal `verifier`, consumes the nonce, mints,
   and stores `pilotAgentId[tokenId] = handle`.
7. A plain wallet without a `.ai` handle, or without a valid verifier
   permit, is rejected by the contract itself — not just by the UI.

Why a server verifier instead of an on-chain registry? There is no
verified Binance/SpaceID registry address this contract can trust
directly, and none is invented here. The Binance domain-resolve
endpoint requires a Binance login session, and a user's private
session must never be reused as a backend credential. The contract
trusts the verifier signature; the server must verify the `.ai`
claim before signing. A production resolver (Binance service account
or a verified SpaceID registry address) is still MISSING and BLOCKS
mainnet: until it exists, permits are testnet-allowlist-only.

### Legacy mint() — CLOSED, not just restricted

`mint()` (no handle, no permit) now ALWAYS reverts with
`"FlapPilot: use mintAgent"`. The function is kept only so old
callers get an explicit error instead of a silent change; it can
never mint, never takes BNB, and never emits `PilotMinted`.
`mintAgent()` is the sole public mint path, and it is deliberately
the only mint function in `lib/bnb.ts`'s ABI. There is no longer a
legacy bypass to guard before mainnet — the gate cannot be skirted
through `mint()`.

## Warnings — read before any mainnet step

- **DO NOT deploy to BNB mainnet (56) without an audit and explicit owner approval.**
- **Secure the verifier key before mainnet:** `MINT_VERIFIER_PRIVATE_KEY`
  must live in server env only (not in the repo, not in the browser, not
  in a `NEXT_PUBLIC_` var). If it leaks, rotate it immediately with
  `FlapPilot.setVerifier()` — leaked permits would let anyone mint
  with any `.ai`-formatted handle.
- **Production `.ai` claim verification is still missing** (see above).
  The fail-closed module exists (`lib/agentIdVerify.ts`), but without
  a deployer-configured resolver it refuses every permit, and the
  testnet allowlist is not claim proof. Format validation alone and
  the wallet-ownership challenge signature alone are NOT ownership
  proof. Mainnet must stay closed until a legitimate resolver exists.
- Team vesting is NOT enforced in `FlapToken` v1: the team share goes to
  whatever address is passed at deploy time. Use a vesting wallet/contract
  for that address if the team share must be time-locked.
- `FlapArena` trusts a single verifier address. If that key is compromised,
  fake verified scores can accrue rewards. Rotate it with `setVerifier`
  and consider a multisig / threshold verifier before production.
- Replay physics in `lib/replay.ts` is v1 (pipes only). It MUST be aligned
  exactly with `components/game/GameEngine.tsx` (coins, items, tournament
  speed tiers, full PRNG sequence) before rewards are paid on mainnet.
