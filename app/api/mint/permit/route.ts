import { NextRequest, NextResponse } from 'next/server'
import {
  createPublicClient,
  http,
  isAddress,
  keccak256,
  encodeAbiParameters,
  parseAbi,
  recoverMessageAddress,
} from 'viem'
import { bsc, bscTestnet } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { normalizeAgentIdHandle, isValidAgentIdHandle } from '@/lib/agentId'
import {
  verifyAgentIdClaim,
  buildClaimChallengeMessage,
  BSC_MAINNET_CHAIN_ID,
  BSC_TESTNET_CHAIN_ID,
} from '@/lib/agentIdVerify'

/**
 * POST /api/mint/permit — issue a one-time mintAgent permit signature.
 *
 * Body: {
 *   walletAddress, agentIdHandle, reaction?, risk?, wingColor?,
 *   chainId?: 56 | 97, requestSignature?: `0x...`
 * }
 * Success: { signature, nonce, walletAddress, agentIdHandle, reaction,
 *            risk, wingColor, verifierAddress, chainId, verification }
 *   The signature covers keccak256(abi.encode(walletAddress, agentIdHandle,
 *   reaction, risk, wingColor, nonce)) signed as RAW bytes with the
 *   Ethereum signed-message prefix — exactly what FlapPilot.mintAgent()
 *   recovers. `nonce` is the wallet's CURRENT on-chain mintNonce, read
 *   from FlapPilot before signing, so the permit cannot be replayed.
 *
 * TWO proofs are required before ANY signature is issued — in order:
 *
 * 1. WALLET OWNERSHIP (requestSignature, 401 if it fails).
 *    The applicant must sign this exact challenge message with the
 *    claiming wallet (see buildClaimChallengeMessage in
 *    lib/agentIdVerify.ts):
 *      FarFlappy Agent ID claim challenge
 *      wallet: <0x... lowercase>
 *      agentId: <handle.ai>
 *    The server recovers the signer with viem recoverMessageAddress
 *    and requires signer === walletAddress. THIS PROVES CONTROL OF
 *    THE WALLET ONLY — it does NOT prove the wallet owns the ".ai"
 *    handle. Anyone can sign a challenge for any handle string.
 *
 * 2. ".ai" CLAIM VERIFICATION (verifyAgentIdClaim, 403/503 if it fails).
 *    lib/agentIdVerify.ts, fail-closed:
 *    - Production path: a deployer-configured resolver
 *      (AGENT_ID_RESOLVER_URL, with its own auth) must resolve the
 *      handle to exactly this wallet, as an EOA, not a fallback.
 *    - Testnet-only path: chain 97 AND the exact wallet:handle pair
 *      in AGENT_ID_TESTNET_ALLOWLIST. This proves NOTHING about a
 *      Binance claim and is REJECTED outright for chain 56 — the
 *      route re-checks that here as defence in depth.
 *    - No resolver configured -> verified=false, reason
 *      "resolver not configured" -> 503, NO signature is issued.
 *    Format-only validation never passes this step.
 *
 * Why no direct Binance call here: the Binance domain-resolve endpoint
 * was tried without a Binance login session and answered
 * "Please log in first". This server cannot call it without a session,
 * and a user's private Binance session must never be reused as a
 * backend credential. The deployer must supply a legitimate resolver
 * (Binance service account or a verified SpaceID registry address)
 * via AGENT_ID_RESOLVER_URL before mainnet minting is opened.
 * No such registry address is invented in this repo.
 *
 * Other fail-closed rules (never a fake signature):
 * - If MINT_VERIFIER_PRIVATE_KEY is not set -> 503.
 * - If NEXT_PUBLIC_FLAP_PILOT_ADDRESS is not set -> 503: without the
 *   deployed contract the real nonce cannot be read, and signing with
 *   a guessed nonce would produce an unusable permit.
 * - The private key is NEVER logged and NEVER returned. It lives only
 *   in server env (no NEXT_PUBLIC_ prefix, never committed).
 */
export async function POST(req: NextRequest) {
  let body: {
    walletAddress?: string
    agentIdHandle?: string
    reaction?: number
    risk?: number
    wingColor?: string
    chainId?: number
    requestSignature?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const walletAddress = (body.walletAddress || '').trim()
  if (!isAddress(walletAddress)) {
    return NextResponse.json({ error: 'walletAddress tidak valid (0x...)' }, { status: 400 })
  }
  const agentIdHandle = normalizeAgentIdHandle(body.agentIdHandle || '')
  if (!isValidAgentIdHandle(agentIdHandle)) {
    return NextResponse.json(
      { error: 'agentIdHandle tidak valid: minimal 3 karakter sebelum .ai, huruf kecil/angka/-, berakhiran .ai' },
      { status: 400 },
    )
  }
  const reaction = body.reaction ?? 50
  const risk = body.risk ?? 50
  const wingColor = (body.wingColor || 'gold').trim()
  if (!Number.isInteger(reaction) || reaction < 0 || reaction > 100) {
    return NextResponse.json({ error: 'reaction harus 0-100' }, { status: 400 })
  }
  if (!Number.isInteger(risk) || risk < 0 || risk > 100) {
    return NextResponse.json({ error: 'risk harus 0-100' }, { status: 400 })
  }
  if (!wingColor) {
    return NextResponse.json({ error: 'wingColor wajib diisi' }, { status: 400 })
  }

  // Chain: explicit in body, else the app's configured chain. Only 56/97.
  const envChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID)
  const chainId =
    body.chainId !== undefined && body.chainId !== null
      ? Number(body.chainId)
      : envChainId === BSC_TESTNET_CHAIN_ID
        ? BSC_TESTNET_CHAIN_ID
        : BSC_MAINNET_CHAIN_ID
  if (chainId !== BSC_MAINNET_CHAIN_ID && chainId !== BSC_TESTNET_CHAIN_ID) {
    return NextResponse.json({ error: 'chainId harus 56 (BNB Chain) atau 97 (BSC Testnet)' }, { status: 400 })
  }

  // --- Proof 1: wallet ownership via signed challenge (401 on failure) ---
  const requestSignature = (body.requestSignature || '').trim()
  if (!requestSignature) {
    return NextResponse.json(
      {
        error: 'requestSignature wajib: tanda tangani pesan challenge dengan wallet yang mengklaim handle ini',
        challengeMessage: buildClaimChallengeMessage(walletAddress, agentIdHandle),
      },
      { status: 401 },
    )
  }
  let recoveredSigner: string
  try {
    recoveredSigner = await recoverMessageAddress({
      message: buildClaimChallengeMessage(walletAddress, agentIdHandle),
      signature: requestSignature as `0x${string}`,
    })
  } catch {
    return NextResponse.json({ error: 'requestSignature tidak valid' }, { status: 401 })
  }
  if (recoveredSigner.toLowerCase() !== walletAddress.toLowerCase()) {
    return NextResponse.json(
      { error: 'requestSignature bukan dari walletAddress yang diklaim (kepemilikan wallet tidak terbukti)' },
      { status: 401 },
    )
  }
  // NOTE: passing proof 1 proves wallet control only — NOT ".ai" ownership.

  // --- Proof 2: ".ai" claim verification, fail-closed (no signature on failure) ---
  const verification = await verifyAgentIdClaim(agentIdHandle, walletAddress, chainId)
  // Defence in depth: testnet-allowlist must never produce a mainnet permit,
  // even if a future verifyAgentIdClaim change ever returned it for chain 56.
  if (chainId === BSC_MAINNET_CHAIN_ID && verification.method === 'testnet-allowlist') {
    return NextResponse.json(
      { error: 'testnet-allowlist tidak berlaku untuk mainnet (chain 56)', verification },
      { status: 403 },
    )
  }
  if (!verification.verified) {
    const isConfigError = (verification.reason || '').includes('resolver not configured')
    return NextResponse.json(
      {
        error: `Verifikasi klaim .ai gagal: ${verification.reason || 'tidak terverifikasi'}`,
        verification,
      },
      { status: isConfigError ? 503 : 403 },
    )
  }

  const verifierKey = process.env.MINT_VERIFIER_PRIVATE_KEY
  if (!verifierKey) {
    return NextResponse.json(
      { error: 'verifier not configured: MINT_VERIFIER_PRIVATE_KEY belum diset di server' },
      { status: 503 },
    )
  }
  const pilotAddress = process.env.NEXT_PUBLIC_FLAP_PILOT_ADDRESS
  if (!pilotAddress || !isAddress(pilotAddress)) {
    return NextResponse.json(
      { error: 'verifier not configured: NEXT_PUBLIC_FLAP_PILOT_ADDRESS belum diset, nonce on-chain tidak bisa dibaca' },
      { status: 503 },
    )
  }

  try {
    const chain = chainId === BSC_TESTNET_CHAIN_ID ? bscTestnet : bsc
    const publicClient = createPublicClient({ chain, transport: http() })
    const nonce = await publicClient.readContract({
      address: pilotAddress as `0x${string}`,
      abi: parseAbi(['function mintNonce(address) view returns (uint256)']),
      functionName: 'mintNonce',
      args: [walletAddress as `0x${string}`],
    })

    const digest = keccak256(
      encodeAbiParameters(
        [
          { type: 'address' },
          { type: 'string' },
          { type: 'uint8' },
          { type: 'uint8' },
          { type: 'string' },
          { type: 'uint256' },
        ],
        [walletAddress as `0x${string}`, agentIdHandle, reaction, risk, wingColor, nonce],
      ),
    )
    const account = privateKeyToAccount(verifierKey as `0x${string}`)
    // Sign the RAW digest bytes: viem applies the Ethereum signed-message
    // prefix, matching MessageHashUtils.toEthSignedMessageHash in the contract.
    const signature = await account.signMessage({ message: { raw: digest } })

    return NextResponse.json({
      signature,
      nonce: Number(nonce),
      walletAddress,
      agentIdHandle,
      reaction,
      risk,
      wingColor,
      chainId,
      verifierAddress: account.address,
      verification,
      warning:
        verification.method === 'testnet-allowlist'
          ? 'Terverifikasi lewat testnet-allowlist SAJA — ini bukan bukti klaim Binance. Hanya berlaku untuk BSC Testnet (97), tidak pernah untuk mainnet.'
          : 'Klaim .ai terverifikasi lewat resolver yang dikonfigurasi deployer, dan kepemilikan wallet terbukti lewat signature challenge.',
    })
  } catch {
    // Never leak the key or internal details; a chain-read failure means
    // no trustworthy nonce, so no signature is issued at all.
    return NextResponse.json(
      { error: 'Gagal membuat permit (verifier/chain tidak bisa dihubungi)' },
      { status: 503 },
    )
  }
}
