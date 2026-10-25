/**
 * Binance Agent ID handle helpers for FarFlappy AI Arena.
 *
 * IMPORTANT — what this file does NOT do:
 * Validating the FORMAT of a ".ai" handle here does NOT prove that the
 * wallet actually owns / claimed that Agent ID in the Binance App.
 * Agent ID is a SPACE ID-based ".ai" domain claimed in Binance App
 * (Web3 wallet -> Agent ID), one per user, and the `baw` agent-id check
 * only verifies the wallet that is currently connected — it cannot verify
 * an arbitrary visitor's claim. The real claim check must happen on the
 * server (app/api/mint/permit/route.ts) BEFORE it signs a permit, via
 * lib/agentIdVerify.ts. That module is FAIL-CLOSED: without a
 * deployer-configured resolver it returns verified=false, and the
 * permit route must not sign. A testnet-only allowlist exists for
 * BSC Testnet (97) testing and is rejected outright for mainnet (56).
 * Until a production resolver (Binance service account or a verified
 * SpaceID registry address) exists, mintAgent permits must only be
 * issued on BSC Testnet for allowlisted test pairs.
 *
 * Wallet-ownership proof is separate and lives in lib/agentIdVerify.ts
 * (buildClaimChallengeMessage): the applicant signs a challenge
 * message and the server recovers the signer. That proves control
 * of the wallet — it does NOT prove ownership of the ".ai" handle.
 */

/** A MintPermit is the exact data the server verifier signs. */
export interface MintPermit {
  walletAddress: `0x${string}`
  agentIdHandle: string
  reaction: number
  risk: number
  wingColor: string
  /** The minter's current on-chain mintNonce, read by the permit server. */
  nonce: number
}

/**
 * ABI types, in order, of the payload the verifier signs.
 * The contract computes:
 *   digest = keccak256(abi.encode(minter, agentIdHandle, reaction, risk,
 *                                  wingColor, nonce))
 * and recovers ECDSA from toEthSignedMessageHash(digest).
 * The server signs the RAW digest bytes with signMessage({ message: { raw: digest } }),
 * which applies the same Ethereum signed-message prefix on-chain and off-chain.
 * If any field order or type changes here, it MUST change identically in
 * contracts/FlapPilot.sol and app/api/mint/permit/route.ts.
 */
export const PERMIT_ABI_TYPES = [
  'address',
  'string',
  'uint8',
  'uint8',
  'string',
  'uint256',
] as const

/** Lowercase + trim, without changing the meaning of the handle. */
export function normalizeAgentIdHandle(handle: string): string {
  return handle.trim().toLowerCase()
}

/**
 * Format-only check: prefix >= 3 chars, lowercase a-z / 0-9 / '-',
 * not starting or ending with '-', suffix exactly ".ai".
 * This mirrors FlapPilot.isValidAgentIdHandle() on-chain.
 */
export function isValidAgentIdHandle(handle: string): boolean {
  const h = normalizeAgentIdHandle(handle)
  if (h.length < 6 || h.length > 64) return false
  if (!h.endsWith('.ai')) return false
  const prefix = h.slice(0, -3)
  if (prefix.length < 3) return false
  if (prefix.startsWith('-') || prefix.endsWith('-')) return false
  return /^[a-z0-9-]+$/.test(prefix)
}

/** Human-readable explanation of a validation failure, or null if valid. */
export function agentIdHandleError(handle: string): string | null {
  const h = normalizeAgentIdHandle(handle)
  if (!h) return 'Masukkan handle .ai, contoh: luna404.ai'
  if (!h.endsWith('.ai')) return 'Handle harus berakhiran .ai'
  if (h.slice(0, -3).length < 3) return 'Minimal 3 karakter sebelum .ai'
  if (!isValidAgentIdHandle(h)) return 'Handle hanya boleh huruf kecil, angka, dan -, tanpa - di awal/akhir'
  return null
}

/**
 * Build the human-readable permit message for display / debugging.
 * This string itself is NOT what gets signed. What gets signed is the
 * keccak256(abi.encode(...)) digest described above, signed as raw bytes
 * with the Ethereum signed-message prefix. This function exists so the
 * UI, the server and the contract can never drift apart about which
 * fields are in a permit: wallet, handle, reaction, risk, wingColor, nonce.
 */
export function buildPermitMessage(permit: MintPermit): string {
  return [
    'FarFlappy mintAgent permit',
    `wallet: ${permit.walletAddress}`,
    `agentId: ${permit.agentIdHandle}`,
    `reaction: ${permit.reaction}`,
    `risk: ${permit.risk}`,
    `wingColor: ${permit.wingColor}`,
    `nonce: ${permit.nonce}`,
    `signed payload: keccak256(abi.encode(${PERMIT_ABI_TYPES.join(', ')})) with the values above, in this order, then Ethereum signed-message prefix`,
  ].join('\n')
}
