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

## Hardhat deploy project (separate from the Next.js app)

`contracts/` is its own Hardhat project so the Next.js `package.json` in
the repo root is untouched. All commands below run from `contracts/`.

### Install and compile

```bash
cd contracts
npm install
npx hardhat compile
```

`hardhat.config.ts` points the compiler at the `.sol` files already in
this folder; the contracts are NOT moved. Two config details exist for
a reason, do not "clean them up" without re-running compile:
- `sources: "./src"` — `src/` contains only symlinks to the three
  top-level `.sol` files. Hardhat cannot use `sources: "."` here: it
  would scan `contracts/node_modules` as local sources and fail
  (HH1006). The real files stay at `contracts/*.sol` so repo docs
  keep working; `src/` is just the compiler's view of them.
- Compiler `0.8.24` + `evmVersion: "cancun"` + `viaIR: true` — 0.8.24
  satisfies both the contracts' `^0.8.20` pragma and OpenZeppelin
  ^5's `^0.8.24` requirement; Cancun is needed for OZ's `mcopy`
  opcode; via-IR is needed because `FlapPilot.mintAgent` hits
  "stack too deep" with legacy codegen. None of these change any
  contract logic.

### Deploy — BSC Testnet first, always

Deploy order, implemented in `scripts/deploy.ts` (read that file's header
for the constructor facts it was written against):

1. `FlapPilot()` — no constructor args; owner = deployer.
2. `FlapToken(rewardPool, liquidity, team, community, treasury)` —
   fixed 1,000,000,000 FLAP, split 40/20/15/15/10 in that order.
3. `FlapArena(flapToken, flapPilot, verifier)` — token and pilot are
   immutable; verifier is the `recordVerifiedScore` caller.
4. `FlapPilot.setArena(arenaAddress)` — so the arena can record
   verified results.
5. `FlapPilot.setVerifier(verifierAddress)` — the address whose
   signatures `mintAgent()` accepts.
6. Transfer the 40% reward share (400,000,000 FLAP) from the deployer
   to the arena, so `claimReward` / `distributePrize` can pay out.

**Why step 2 uses the deployer as rewardPool — read this, it is not a
mistake:** `FlapToken`'s rewardPool ideally IS the FlapArena address,
but `FlapArena`'s constructor needs the `FlapToken` address, which
cannot exist before `FlapToken` is deployed. No single-pass order
satisfies both, and the contracts are deliberately NOT changed to
break the circularity (their immutables are part of the audited
surface). So the script deploys `FlapToken` with rewardPool =
deployer as an interim holder, then moves exactly that 40% share to
the arena in step 6 and verifies the arena balance on-chain. If a
guide claims rewardPool = arena in one constructor call for these
contracts, it is wrong for this codebase.

### Env needed (names only — never put values in the repo)

Create `contracts/.env` (untracked, see `.env.example` in this folder
for the full template). Required before any deploy:

| Variable | Purpose |
| --- | --- |
| `DEPLOYER_PRIVATE_KEY` | Deployer EOA. **NOT the Binance agent wallet**: that wallet is MPC, has no exportable key, and `baw` has no deploy command. For testnet use a fresh testnet-only wallet funded with tBNB from a faucet. Never reuse a mainnet key for testnet. |
| `BSC_TESTNET_RPC_URL` | RPC for chain 97. |
| `BSC_RPC_URL` | RPC for chain 56 (mainnet only). |
| `VERIFIER_ADDRESS` | Optional. Defaults to the agent wallet `0x9707C99D8247fBBB5E806a389160372602578009` (luna404.ai — a public address, not a secret). See "Verifier modes" below. |
| `FLAP_LIQUIDITY_ADDRESS`, `FLAP_TEAM_ADDRESS`, `FLAP_COMMUNITY_ADDRESS`, `FLAP_TREASURY_ADDRESS` | Optional. Each defaults to the deployer — fine for throwaway testnet, **forbidden for mainnet** unless `CONFIRM_MAINNET_DISTRIBUTION=yes` is also set. For mainnet these MUST be multisig / vesting wallets. |
| `CONFIRM_MAINNET_DEPLOY` | Must be exactly `yes` or a mainnet (56) deploy is refused by the script. |
| `CONFIRM_MAINNET_DISTRIBUTION` | Must be exactly `yes` on mainnet if any distribution address still defaults to the deployer. |
| `REWARD_FUNDING` | Optional, `skip` only: deploy without moving the 40% share to the arena (you must then transfer it manually before rewards can be paid). |

The script refuses to run — before sending any transaction — if
`DEPLOYER_PRIVATE_KEY` is missing/malformed, if the RPC URL for the
target network is missing, if the deployer balance is 0, or (on
mainnet) if the two `CONFIRM_*` guards above are not satisfied. It
never prints or writes a private key.

### Run it

```bash
cd contracts
cp .env.example .env   # then fill in .env locally; NEVER commit it
npm install
npx hardhat compile

# Testnet first (chain 97):
npm run deploy:testnet
# Mainnet only after audit + production resolver + owner approval:
# CONFIRM_MAINNET_DEPLOY=yes CONFIRM_MAINNET_DISTRIBUTION=yes npm run deploy:mainnet
```

The script prints the three deployed addresses and writes them to
`contracts/deployments/<network>.json`. That file is gitignored (only
`deployments/.gitkeep` is committed) — do not commit deployment
records. Then verify on BscScan (the script prints the exact
commands, with the real constructor args):

```bash
npx hardhat verify --network bscTestnet <PILOT_ADDRESS>
npx hardhat verify --network bscTestnet <TOKEN_ADDRESS> <deployer> <liquidity> <team> <community> <treasury>
npx hardhat verify --network bscTestnet <ARENA_ADDRESS> <TOKEN_ADDRESS> <PILOT_ADDRESS> <VERIFIER_ADDRESS>
```

Then copy the three addresses into the Next.js `.env` as
`NEXT_PUBLIC_FLAP_PILOT_ADDRESS`, `NEXT_PUBLIC_FLAP_TOKEN_ADDRESS`,
`NEXT_PUBLIC_FLAP_ARENA_ADDRESS` (and `NEXT_PUBLIC_CHAIN_ID=97` for
testnet). Never commit a private key.

### Verifier modes — pick one, do not mix them up

- **Verifier = agent wallet (default).** Permits for `mintAgent` must
  then be signed by that wallet itself (e.g. `baw sign-message`).
  A server `MINT_VERIFIER_PRIVATE_KEY` can NEVER produce this
  address, because the agent wallet key cannot be exported. This
  mode works for a first mint test even on testnet: message signing
  is off-chain and chain-agnostic, so the agent wallet can sign a
  permit for a testnet minter without ever holding tBNB.
- **Verifier = a server key's address.** Set `VERIFIER_ADDRESS` to
  that key's address at deploy time, and set the same key as
  `MINT_VERIFIER_PRIVATE_KEY` in the Next.js server env only
  (no `NEXT_PUBLIC_` prefix, never committed). Only then can
  `/api/mint/permit` sign permits automatically. If
  `MINT_VERIFIER_PRIVATE_KEY` is unset, `/api/mint/permit` returns
  503 and issues no permit.

### First mint test (after a testnet deploy)

1. Deploy to BSC Testnet (97) and fill the three Next.js addresses.
2. For testnet only, add the test minter as
   `AGENT_ID_TESTNET_ALLOWLIST=0xTestWallet:handle.ai` in the Next.js
   server env. This proves NOTHING about a Binance claim and is
   rejected outright for chain 56 — it exists only so the flow can
   be tested before a production resolver exists.
3. The test minter connects on `/mint`, signs the challenge, requests
   a permit, and calls `mintAgent` with 0.01 tBNB (testnet BNB).
4. The real first mint as `luna404.ai` happens on mainnet only after
   audit + production resolver — on testnet the agent wallet itself
   cannot be the minter because `baw` has no chain 97, but it CAN be
   the verifier signer (see above).

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
