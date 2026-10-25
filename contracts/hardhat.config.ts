import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";

// Hardhat project root is contracts/ itself, and the .sol files already live
// at that top level (FlapPilot.sol, FlapToken.sol, FlapArena.sol) — those
// paths are kept so the repo docs (README.md, lib comments) stay valid.
// Hardhat cannot use sources: "." here: it would scan contracts/node_modules
// as local sources and fail (HH1006). So sources is ./src, which contains
// only symlinks to the three top-level .sol files. The real files stay at
// contracts/*.sol; src/ is just the compiler's view of them.
const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
const accounts = deployerKey ? [deployerKey] : [];

const config: HardhatUserConfig = {
  solidity: {
    // 0.8.24: satisfies the contracts' ^0.8.20 pragma AND OpenZeppelin ^5's
    // ^0.8.24 requirement. Do NOT set this to 0.8.20 — OZ ^5 will not compile.
    version: "0.8.24",
    // cancun: OpenZeppelin ^5 uses the mcopy opcode, which needs Cancun.
    // viaIR: FlapPilot.mintAgent hits "stack too deep" with the legacy
    // codegen (many calldata + locals in one function). via-IR compiles it
    // without changing any contract logic. If via-IR is ever removed, that
    // function must be refactored (e.g. split the permit check into an
    // internal helper) before it will compile again.
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun", viaIR: true },
  },
  paths: {
    sources: "./src",
    artifacts: "./artifacts",
    cache: "./cache",
    tests: "./test",
  },
  networks: {
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC_URL || "",
      chainId: 97,
      accounts,
    },
    bsc: {
      url: process.env.BSC_RPC_URL || "",
      chainId: 56,
      accounts,
    },
  },
};

export default config;
