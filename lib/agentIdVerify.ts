/**
 * Server-side Binance Agent ID claim verification for FarFlappy AI Arena.
 *
 * HONEST BOUNDARY — read this before touching mainnet:
 * - The Binance domain-resolve endpoint
 *   (/bapi/defi/v1/public/wallet-direct/agent-wallet/domain/resolve)
 *   was tried WITHOUT a Binance login session and answered
 *   "Please log in first". A Next.js server therefore CANNOT call it
 *   without a session, and the user's private Binance session must
 *   NEVER be reused/shared as a backend service credential.
 * - No verified SpaceID ".ai" registry address was found by search, and
 *   none is invented here. Do NOT hard-code a registry address.
 * - So this module is FAIL-CLOSED by default: without a resolver
 *   configured by the deployer, verifyAgentIdClaim() returns
 *   verified=false and the permit route must NOT sign. Format-only
 *   validation (lib/agentId.ts) never counts as claim proof.
 *
 * What "verified" means here, in order of strength:
 * 1. "resolver" — a deployer-configured resolver endpoint (with its own
 *    auth, e.g. a Binance service account) resolved this handle to
 *    exactly this wallet address, on the requested chain, as an EOA
 *    (not a fallback address, not a contract).
 * 2. "testnet-allowlist" — TESTNET ONLY (chain 97). The deployer listed
 *    this exact wallet:handle pair in AGENT_ID_TESTNET_ALLOWLIST.
 *    This proves NOTHING about a Binance claim; it exists only so
 *    testnet minting can be exercised before a production resolver
 *    exists. It MUST be empty on mainnet and the permit route MUST
 *    reject it for chain 56.
 *
 * Challenge / wallet-ownership proof is a SEPARATE step and is NOT
 * this module: the permit route requires the applicant to sign a
 * challenge message (see buildClaimChallengeMessage below) and
 * recovers the signer with viem recoverMessageAddress. That proves
 * the applicant controls the wallet — it does NOT prove the wallet
 * owns the ".ai" handle. Both proofs are required before a permit.
 */

import { normalizeAgentIdHandle, isValidAgentIdHandle } from './agentId'

export const BSC_MAINNET_CHAIN_ID = 56
export const BSC_TESTNET_CHAIN_ID = 97

export type AgentIdVerifyMethod = 'resolver' | 'testnet-allowlist' | 'none'

export interface AgentIdClaimVerification {
  verified: boolean
  method: AgentIdVerifyMethod
  /** The address the resolver returned for the handle, if any. */
  resolvedAddress?: string
  /** Machine-readable reason when verified=false (also returned on success as context). */
  reason?: string
}

/**
 * Challenge message the applicant must sign to prove wallet ownership.
 * Format is fixed and documented here so the UI, the permit route and
 * any future auditor can never drift apart:
 *
 *   FarFlappy Agent ID claim challenge
 *   wallet: <0x...>
 *   agentId: <handle.ai>
 *
 * Signing this proves control of the wallet. It does NOT prove the
 * wallet owns the ".ai" handle — that is verifyAgentIdClaim()'s job.
 */
export function buildClaimChallengeMessage(walletAddress: string, agentIdHandle: string): string {
  return [
    'FarFlappy Agent ID claim challenge',
    `wallet: ${walletAddress.toLowerCase()}`,
    `agentId: ${normalizeAgentIdHandle(agentIdHandle)}`,
  ].join('\n')
}

/** Parse AGENT_ID_TESTNET_ALLOWLIST: "0xWallet:handle.ai,0xOther:other.ai". */
export function parseTestnetAllowlist(raw: string | undefined | null): Array<{ wallet: string; handle: string }> {
  if (!raw) return []
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [wallet, handle] = entry.split(':').map((part) => part.trim())
      return { wallet: (wallet || '').toLowerCase(), handle: normalizeAgentIdHandle(handle || '') }
    })
    .filter((entry) => entry.wallet && entry.handle)
}

function isTestnetAllowlisted(
  walletAddress: string,
  agentIdHandle: string,
  allowlistRaw: string | undefined | null,
): boolean {
  const wallet = walletAddress.toLowerCase()
  const handle = normalizeAgentIdHandle(agentIdHandle)
  return parseTestnetAllowlist(allowlistRaw).some(
    (entry) => entry.wallet === wallet && entry.handle === handle,
  )
}

interface ResolverResponse {
  address?: string
  isFallback?: boolean
  addressType?: string
  data?: ResolverResponse
}

/** Extract address / fallback / type from either a flat or { data: {...} } shape. */
function flattenResolverResponse(json: unknown): ResolverResponse {
  if (!json || typeof json !== 'object') return {}
  const obj = json as ResolverResponse
  if (obj.data && typeof obj.data === 'object') return { ...obj.data, data: undefined }
  return obj
}

/**
 * Call a deployer-configured resolver for this handle on this chain.
 * Expected contract (documented for whoever configures the endpoint):
 *   POST {AGENT_ID_RESOLVER_URL} with JSON { name: handle, chainId }
 *   -> 200 with JSON { address, isFallback, addressType } or { data: {...} }
 * where addressType is "EOA" for a normal wallet. Any other shape,
 * non-200 status, network error, fallback address, or non-EOA type
 * is a verification FAILURE (fail-closed), never a pass.
 *
 * The deployer supplies the endpoint AND its auth (e.g. via a reverse
 * proxy or a service account configured outside this repo). This code
 * deliberately does NOT call the Binance bapi domain-resolve endpoint
 * directly: that endpoint requires a Binance login session, and a
 * user's private session must never be reused as a backend credential.
 */
async function resolveViaConfiguredResolver(
  agentIdHandle: string,
  chainId: number,
  resolverUrl: string,
): Promise<AgentIdClaimVerification> {
  let res: Response
  try {
    res = await fetch(resolverUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: agentIdHandle, chainId }),
      // A resolver that hangs must not hang the permit route forever.
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    return { verified: false, method: 'none', reason: 'resolver unreachable' }
  }
  if (!res.ok) {
    return { verified: false, method: 'none', reason: `resolver returned HTTP ${res.status}` }
  }
  let json: unknown
  try {
    json = await res.json()
  } catch {
    return { verified: false, method: 'none', reason: 'resolver returned invalid JSON' }
  }
  const flat = flattenResolverResponse(json)
  const resolvedAddress = typeof flat.address === 'string' ? flat.address : undefined
  if (!resolvedAddress) {
    return { verified: false, method: 'none', reason: 'resolver returned no address for this handle' }
  }
  if (flat.isFallback === true) {
    return {
      verified: false,
      method: 'none',
      resolvedAddress,
      reason: 'resolver returned a fallback address, not an address set for this chain — owner may not control it',
    }
  }
  if (flat.addressType !== 'EOA') {
    return {
      verified: false,
      method: 'none',
      resolvedAddress,
      reason: `resolver addressType is not EOA (got: ${flat.addressType ?? 'unknown'}) — cannot confirm a normal wallet`,
    }
  }
  return { verified: true, method: 'resolver', resolvedAddress, reason: 'resolver matched' }
}

/**
 * Verify that this wallet actually claimed this ".ai" handle.
 *
 * @param agentIdHandle - e.g. "luna404.ai" (format must already be valid)
 * @param walletAddress - the connected wallet claiming the handle
 * @param chainId - 56 (BNB mainnet) or 97 (BSC Testnet). Testnet-allowlist
 *   is ONLY honoured for 97 and is REJECTED for 56, even if the pair
 *   is listed — so a mainnet deployment with a stale allowlist env
 *   still fails closed.
 * @param env - injectable for tests; defaults to process.env.
 */
export async function verifyAgentIdClaim(
  agentIdHandle: string,
  walletAddress: string,
  chainId: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgentIdClaimVerification> {
  const handle = normalizeAgentIdHandle(agentIdHandle)
  const wallet = walletAddress.toLowerCase()

  if (!isValidAgentIdHandle(handle)) {
    return { verified: false, method: 'none', reason: 'invalid .ai handle format' }
  }
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) {
    return { verified: false, method: 'none', reason: 'invalid wallet address' }
  }

  // TESTNET ONLY: explicit deployer allowlist. Rejected outright on mainnet.
  if (chainId === BSC_TESTNET_CHAIN_ID) {
    if (isTestnetAllowlisted(wallet, handle, env.AGENT_ID_TESTNET_ALLOWLIST)) {
      return {
        verified: true,
        method: 'testnet-allowlist',
        reason: 'testnet allowlist match — proves nothing about a Binance claim; testnet only',
      }
    }
  } else if (chainId !== BSC_MAINNET_CHAIN_ID) {
    return { verified: false, method: 'none', reason: `unsupported chainId: ${chainId}` }
  }

  // PRODUCTION PATH: a resolver configured by the deployer, with its own auth.
  const resolverUrl = (env.AGENT_ID_RESOLVER_URL || '').trim()
  if (!resolverUrl) {
    return {
      verified: false,
      method: 'none',
      reason: 'resolver not configured — AGENT_ID_RESOLVER_URL is empty, so no Binance/SpaceID claim can be proven (fail-closed)',
    }
  }

  const resolved = await resolveViaConfiguredResolver(handle, chainId, resolverUrl)
  if (!resolved.verified || !resolved.resolvedAddress) {
    return resolved
  }
  if (resolved.resolvedAddress.toLowerCase() !== wallet) {
    return {
      verified: false,
      method: 'none',
      resolvedAddress: resolved.resolvedAddress,
      reason: 'resolver address does not match the claiming wallet',
    }
  }
  return { verified: true, method: 'resolver', resolvedAddress: resolved.resolvedAddress, reason: 'resolver address matches wallet' }
}
