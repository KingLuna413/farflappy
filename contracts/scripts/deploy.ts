import hre from "hardhat";
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

/**
 * FarFlappy AI Arena — deploy script (BSC Testnet first, BSC mainnet guarded).
 *
 * CONSTRUCTOR FACTS, read verbatim from the .sol files in this folder
 * (do not edit this script to match a different signature without also
 * updating the contracts — the script must match the contracts, not vice
 * versa):
 *   FlapPilot()                              — no args; owner = deployer.
 *   FlapToken(rewardPool, liquidity, team, community, treasury)
 *                                            — fixed 1,000,000,000 FLAP;
 *                                              40/20/15/15/10 in that order.
 *   FlapArena(flapToken, pilot, verifier)    — flapToken and pilot are
 *                                              immutable; verifier is the
 *                                              recordVerifiedScore caller.
 *   FlapPilot.setArena(arena)                — onlyOwner.
 *   FlapPilot.setVerifier(verifier)          — onlyOwner; this is the
 *                                              address whose signatures
 *                                              mintAgent() accepts.
 *
 * CIRCULAR-DEPENDENCY NOTE (read before changing the order):
 * FlapToken's rewardPool ideally IS the FlapArena address, but FlapArena's
 * constructor needs the FlapToken address, which cannot exist before
 * FlapToken is deployed. There is no order that satisfies both in one
 * pass, and the contracts are deliberately NOT changed to break this
 * (their immutables are part of the audited surface). So this script
 * uses the recoverable two-step pattern instead:
 *   1. Deploy FlapToken with rewardPool = deployer (interim holder).
 *   2. Deploy FlapArena, then transfer the full 40% reward share from the
 *      deployer to the arena. The arena then holds exactly the share the
 *      constructor would have sent it, and claimReward / distributePrize
 *      pay out of that balance.
 * If you ever see a deploy guide claiming rewardPool = arena in a single
 * constructor call for these contracts, it is wrong for this codebase.
 *
 * DEPLOY ORDER (this script):
 *   1. FlapPilot
 *   2. FlapToken (rewardPool = deployer, interim)
 *   3. FlapArena (flapToken, flapPilot, verifier)
 *   4. FlapPilot.setArena(arena)
 *   5. FlapPilot.setVerifier(verifier)
 *   6. Transfer 40% of FLAP supply (deployer -> arena)
 *
 * VERIFIER MODES — pick one, do not mix them up:
 *   (a) verifier = agent wallet 0x9707C99D8247fBBB5E806a389160372602578009
 *       (default, public address, NOT a secret): permits must be signed
 *       by that wallet, e.g. via `baw sign-message`. A server
 *       MINT_VERIFIER_PRIVATE_KEY can NEVER produce this address, because
 *       the agent wallet is MPC with no exportable key.
 *   (b) verifier = a server key's address (set VERIFIER_ADDRESS to it):
 *       automated permits work, but only if that same key is set as
 *       MINT_VERIFIER_PRIVATE_KEY in the Next.js server env — never here.
 *
 * This script NEVER deploys, and it never prints a private key. It only
 * prints public addresses and the Next.js env lines to copy afterwards.
 */

const AGENT_WALLET = "0x9707C99D8247fBBB5E806a389160372602578009"; // luna404.ai, public

function fail(message: string): never {
  throw new Error(`DEPLOY ABORTED: ${message}`);
}

function envOrDefault(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : fallback;
}

async function main() {
  const networkName = hre.network.name;
  if (networkName !== "bscTestnet" && networkName !== "bsc") {
    fail(
      `refusing to deploy to network "${networkName}". Use --network bscTestnet (97) first. ` +
        `Mainnet (bsc, 56) only via --network bsc with the guards below.`,
    );
  }
  const isMainnet = networkName === "bsc";

  // --- Required env, checked BEFORE ANY provider call ----------------------
  // Order matters: calling hre.ethers.provider.getNetwork() first would
  // make Hardhat itself fail with a raw HH117 "empty URL" error when the
  // RPC env is missing, instead of the clear message below. So every env
  // and guard check below runs before the first network call.
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!deployerKey || !/^0x[0-9a-fA-F]{64}$/.test(deployerKey.trim())) {
    fail(
      "DEPLOYER_PRIVATE_KEY is not set (or not a 0x-prefixed 64-hex key). " +
        "Set it in contracts/.env (untracked) to a SEPARATE deployer EOA — " +
        "NOT the Binance agent wallet, which has no exportable key. " +
        "For testnet, fund that wallet with tBNB from a faucet first.",
    );
  }
  const rpcEnvName = isMainnet ? "BSC_RPC_URL" : "BSC_TESTNET_RPC_URL";
  const rpcUrl = process.env[rpcEnvName];
  if (!rpcUrl) {
    fail(`no RPC URL configured for ${networkName}. Set ${rpcEnvName} in contracts/.env.`);
  }

  // --- Mainnet guards (hard stops, not comments) ---------------------------
  if (isMainnet && process.env.CONFIRM_MAINNET_DEPLOY !== "yes") {
    fail(
      "refusing BSC mainnet (56) deploy: set CONFIRM_MAINNET_DEPLOY=yes. " +
        "Do not do this before an audit, a production .ai resolver, and " +
        "explicit owner approval (see contracts/README.md).",
    );
  }

  // --- Only now touch the network, and verify the chain matches ------------
  const chainId = (await hre.ethers.provider.getNetwork()).chainId;
  if (chainId !== 97n && chainId !== 56n) {
    fail(`unexpected chainId ${chainId} for network ${networkName}; expected 97 or 56.`);
  }
  if (isMainnet !== (chainId === 56n)) {
    fail(`network/chain mismatch: --network ${networkName} but chainId ${chainId}. Aborting.`);
  }

  const [deployer] = await hre.ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const deployerBalance = await hre.ethers.provider.getBalance(deployerAddress);
  console.log(`Network: ${networkName} (chain ${chainId})`);
  console.log(`Deployer: ${deployerAddress}`);
  console.log(`Deployer balance: ${ethers.formatEther(deployerBalance)} BNB (must cover 3 deploys + setup txs)`);
  if (deployerBalance === 0n) {
    fail("deployer balance is 0 — fund it first (tBNB faucet for testnet; never send mainnet funds to a test key).");
  }

  // --- Verifier + distribution addresses ------------------------------------
  const verifier = envOrDefault("VERIFIER_ADDRESS", AGENT_WALLET);
  if (!ethers.isAddress(verifier)) fail(`VERIFIER_ADDRESS "${verifier}" is not a valid address.`);
  if (verifier.toLowerCase() === AGENT_WALLET.toLowerCase()) {
    console.log(
      "WARNING: verifier = agent wallet (luna404.ai). Permits for mintAgent must then be " +
        "signed by that wallet (e.g. `baw sign-message`) — a server MINT_VERIFIER_PRIVATE_KEY " +
        "cannot produce this address. For automated server permits, set VERIFIER_ADDRESS to " +
        "the server key's address instead.",
    );
  }

  const liquidity = envOrDefault("FLAP_LIQUIDITY_ADDRESS", deployerAddress);
  const team = envOrDefault("FLAP_TEAM_ADDRESS", deployerAddress);
  const community = envOrDefault("FLAP_COMMUNITY_ADDRESS", deployerAddress);
  const treasury = envOrDefault("FLAP_TREASURY_ADDRESS", deployerAddress);
  for (const [label, addr] of [
    ["FLAP_LIQUIDITY_ADDRESS", liquidity],
    ["FLAP_TEAM_ADDRESS", team],
    ["FLAP_COMMUNITY_ADDRESS", community],
    ["FLAP_TREASURY_ADDRESS", treasury],
  ]) {
    if (!ethers.isAddress(addr)) fail(`${label} "${addr}" is not a valid address.`);
    if (addr.toLowerCase() === deployerAddress.toLowerCase()) {
      console.log(`WARNING: ${label} defaults to the deployer. OK for throwaway testnet ONLY.`);
    }
  }
  if (isMainnet && [liquidity, team, community, treasury].some((a) => a.toLowerCase() === deployerAddress.toLowerCase())) {
    if (process.env.CONFIRM_MAINNET_DISTRIBUTION !== "yes") {
      fail(
        "refusing mainnet deploy: one or more FlapToken distribution addresses still " +
          "default to the deployer. For mainnet they MUST be multisig / vesting wallets. " +
          "Set FLAP_LIQUIDITY_ADDRESS, FLAP_TEAM_ADDRESS, FLAP_COMMUNITY_ADDRESS and " +
          "FLAP_TREASURY_ADDRESS explicitly, and set CONFIRM_MAINNET_DISTRIBUTION=yes.",
      );
    }
  }

  // --- 1. FlapPilot ---------------------------------------------------------
  console.log("\n[1/6] Deploying FlapPilot (no constructor args)...");
  const PilotFactory = await hre.ethers.getContractFactory("FlapPilot");
  const pilot = await PilotFactory.deploy();
  await pilot.waitForDeployment();
  const pilotAddress = await pilot.getAddress();
  console.log(`FlapPilot: ${pilotAddress}`);

  // --- 2. FlapToken ---------------------------------------------------------
  // rewardPool = deployer as INTERIM holder (see circularity note above).
  // The 40% share is moved to the arena in step 6.
  console.log("\n[2/6] Deploying FlapToken (rewardPool = deployer, interim holder)...");
  const TokenFactory = await hre.ethers.getContractFactory("FlapToken");
  const token = await TokenFactory.deploy(deployerAddress, liquidity, team, community, treasury);
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log(`FlapToken ($FLAP): ${tokenAddress}`);
  console.log("  distribution: 40% rewards (interim: deployer, moved in step 6), 20% liquidity, 15% team, 15% community, 10% treasury");

  // --- 3. FlapArena ---------------------------------------------------------
  console.log("\n[3/6] Deploying FlapArena (flapToken, flapPilot, verifier)...");
  const ArenaFactory = await hre.ethers.getContractFactory("FlapArena");
  const arena = await ArenaFactory.deploy(tokenAddress, pilotAddress, verifier);
  await arena.waitForDeployment();
  const arenaAddress = await arena.getAddress();
  console.log(`FlapArena: ${arenaAddress}`);
  console.log(`  verifier (recordVerifiedScore caller + mintAgent permit signer): ${verifier}`);

  // --- 4. FlapPilot.setArena -------------------------------------------------
  console.log("\n[4/6] FlapPilot.setArena(arena)...");
  await (await pilot.setArena(arenaAddress)).wait();
  console.log(`  pilot.arena = ${await pilot.arena()}`);

  // --- 5. FlapPilot.setVerifier ----------------------------------------------
  console.log("\n[5/6] FlapPilot.setVerifier(verifier)...");
  await (await pilot.setVerifier(verifier)).wait();
  console.log(`  pilot.verifier = ${await pilot.verifier()}`);

  // --- 6. Move the 40% reward share to the arena ------------------------------
  const fundingMode = envOrDefault("REWARD_FUNDING", "");
  if (fundingMode === "skip") {
    console.log("\n[6/6] SKIPPED (REWARD_FUNDING=skip): 40% reward share stays with the deployer.");
    console.log("  You MUST transfer it to the arena manually before any reward can be paid.");
  } else {
    const totalSupply: bigint = await token.totalSupply();
    const rewardShare = (totalSupply * 40n) / 100n;
    console.log(`\n[6/6] Transferring 40% reward share (${ethers.formatEther(rewardShare)} FLAP) deployer -> arena...`);
    await (await token.transfer(arenaAddress, rewardShare)).wait();
    const arenaBalance: bigint = await token.balanceOf(arenaAddress);
    console.log(`  arena FLAP balance: ${ethers.formatEther(arenaBalance)}`);
    if (arenaBalance !== rewardShare) fail("arena FLAP balance does not match the 40% reward share after transfer.");
  }

  // --- Write deployment record (public addresses only, gitignored) -----------
  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const record = {
    network: networkName,
    chainId: Number(chainId),
    deployedAt: new Date().toISOString(),
    deployer: deployerAddress,
    verifier,
    verifierMode:
      verifier.toLowerCase() === AGENT_WALLET.toLowerCase()
        ? "agent-wallet (permits via baw sign-message; no server key can produce this address)"
        : "server key (set MINT_VERIFIER_PRIVATE_KEY for this address in the Next.js server env)",
    contracts: { FlapPilot: pilotAddress, FlapToken: tokenAddress, FlapArena: arenaAddress },
    tokenDistribution: {
      note: "rewardPool constructor arg was the deployer as interim holder; the 40% share was then transferred to the arena (step 6) unless REWARD_FUNDING=skip.",
      rewardPoolInterimHolder: deployerAddress,
      rewardPoolFinal: arenaAddress,
      liquidity,
      team,
      community,
      treasury,
    },
    warnings: [
      "NOT audited. Do not use mainnet addresses for real funds until an audit is done.",
      "Team share has NO on-chain vesting in FlapToken v1 — use a vesting wallet for mainnet.",
      "Production .ai resolver is still required before mainnet permits (see contracts/README.md).",
    ],
  };
  const outPath = path.join(outDir, `${networkName}.json`);
  fs.writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n");
  console.log(`\nDeployment record written to contracts/deployments/${networkName}.json (gitignored — do not commit).`);

  console.log("\n=== Next.js env to copy (public addresses only) ===");
  console.log(`NEXT_PUBLIC_FLAP_PILOT_ADDRESS=${pilotAddress}`);
  console.log(`NEXT_PUBLIC_FLAP_TOKEN_ADDRESS=${tokenAddress}`);
  console.log(`NEXT_PUBLIC_FLAP_ARENA_ADDRESS=${arenaAddress}`);
  console.log(`NEXT_PUBLIC_CHAIN_ID=${Number(chainId)}`);
  console.log("\n=== BscScan verification (run after deploy, with an API key in your local env only) ===");
  console.log(`npx hardhat verify --network ${networkName} ${pilotAddress}`);
  console.log(`npx hardhat verify --network ${networkName} ${tokenAddress} ${deployerAddress} ${liquidity} ${team} ${community} ${treasury}`);
  console.log(`npx hardhat verify --network ${networkName} ${arenaAddress} ${tokenAddress} ${pilotAddress} ${verifier}`);
  console.log("\nDone. No private key was printed or written by this script.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
