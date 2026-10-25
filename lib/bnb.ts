/**
 * BNB Chain configuration for FarFlappy AI Arena.
 *
 * Mainnet: BNB Chain (56). Testing only: BSC Testnet (97).
 * Contract addresses come ONLY from env vars. If they are empty, the app
 * must show a configuration message and must NOT attempt a fake transaction.
 * No contract address is hard-coded here, because none has been deployed yet.
 */

export const BNB_CHAIN_ID = 56
export const BSC_TESTNET_CHAIN_ID = 97

export const CHAIN_NAMES: Record<number, string> = {
  [BNB_CHAIN_ID]: 'BNB Chain',
  [BSC_TESTNET_CHAIN_ID]: 'BSC Testnet',
}

/** Chain id from env, defaulting to BNB mainnet; anything else falls back to 56. */
export function getDefaultChainId(): number {
  const raw = Number(process.env.NEXT_PUBLIC_CHAIN_ID)
  if (raw === BSC_TESTNET_CHAIN_ID) return BSC_TESTNET_CHAIN_ID
  return BNB_CHAIN_ID
}

export const FLAP_PILOT_ADDRESS = (process.env.NEXT_PUBLIC_FLAP_PILOT_ADDRESS || '') as `0x${string}`
export const FLAP_TOKEN_ADDRESS = (process.env.NEXT_PUBLIC_FLAP_TOKEN_ADDRESS || '') as `0x${string}`
export const FLAP_ARENA_ADDRESS = (process.env.NEXT_PUBLIC_FLAP_ARENA_ADDRESS || '') as `0x${string}`

/** True only when all three contract addresses are set in env. */
export const CONTRACTS_CONFIGURED =
  FLAP_PILOT_ADDRESS.length > 0 && FLAP_TOKEN_ADDRESS.length > 0 && FLAP_ARENA_ADDRESS.length > 0

/** Mirror of the on-chain launch constants in contracts/FlapPilot.sol. */
export const FLAP_PILOT_MINT_PRICE_BNB = '0.01'
export const FLAP_PILOT_MAX_SUPPLY = 10_000
export const FLAP_PILOT_MAX_PER_WALLET = 5
export const FLAP_TOTAL_SUPPLY = '1,000,000,000'

import { parseAbi } from 'viem'

/** Minimal ABIs — only the functions the UI actually calls. */
export const FLAP_PILOT_ABI = parseAbi([
  'function mint(uint8 reaction, uint8 risk, string wingColor) payable returns (uint256)',
  'function mintAgent(uint8 reaction, uint8 risk, string wingColor, string agentIdHandle, bytes signature) payable returns (uint256)',
  'function mintNonce(address) view returns (uint256)',
  'function pilotAgentId(uint256 tokenId) view returns (string)',
  'function verifier() view returns (address)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function delegatePilot(uint256 tokenId, address delegatee, uint256 delegateShareBps)',
  'function balanceOf(address owner) view returns (uint256)',
  'event PilotMintedAgent(uint256 indexed tokenId, address indexed owner, string agentIdHandle, uint8 reaction, uint8 risk, string wingColor)',
])

export const FLAP_TOKEN_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
])

export const FLAP_ARENA_ABI = parseAbi([
  'function claimReward(uint256 pilotId)',
  'function pendingRewards(uint256 pilotId) view returns (uint256)',
  'function stakePilot(uint256 pilotId)',
  'function unstakePilot(uint256 pilotId)',
])
