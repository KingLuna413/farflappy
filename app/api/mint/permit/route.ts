import { NextRequest, NextResponse } from 'next/server'
import {
  createPublicClient,
  http,
  isAddress,
  keccak256,
  encodeAbiParameters,
  parseAbi,
} from 'viem'
import { bsc, bscTestnet } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { normalizeAgentIdHandle, isValidAgentIdHandle } from '@/lib/agentId'

/**
 * POST /api/mint/permit — issue a one-time mintAgent permit signature.
 *
 * Body: { walletAddress, agentIdHandle, reaction?, risk?, wingColor? }
 * Success: { signature, nonce, walletAddress, agentIdHandle, reaction,
 *            risk, wingColor, verifierAddress }
 *   The signature covers keccak256(abi.encode(walletAddress, agentIdHandle,
 *   reaction, risk, wingColor, nonce)) signed as RAW bytes with the
 *   Ethereum signed-message prefix — exactly what FlapPilot.mintAgent()
 *   recovers. `nonce` is the wallet's CURRENT on-chain mintNonce, read
 *   from FlapPilot before signing, so the permit cannot be replayed.
 *
 * Honest limitations (read before enabling anywhere near mainnet):
 * - If MINT_VERIFIER_PRIVATE_KEY is not set, this endpoint returns 503
 *   "verifier not configured" and NEVER returns a fake signature.
 * - If NEXT_PUBLIC_FLAP_PILOT_ADDRESS is not set, it returns 503 too:
 *   without the deployed contract it cannot read the real nonce, and
 *   signing with a guessed nonce would produce an unusable permit.
 * - The private key is NEVER logged and NEVER returned. It lives only in
 *   server env (no NEXT_PUBLIC_ prefix, never committed to the repo).
 * - TODO (blocking for mainnet): this endpoint currently validates only
 *   the FORMAT of the ".ai" handle. The real Binance Agent ID claim check
 *   — proving this wallet actually claimed this handle in the Binance App
 *   (SPACE ID .ai domain) — is NOT yet implemented, because `baw`
 *   agent-id only verifies the currently connected wallet, not an
 *   arbitrary visitor. Until that server-side claim verification exists,
 *   permits from this endpoint must only be used on BSC Testnet.
 */
export async function POST(req: NextRequest) {
  let body: {
    walletAddress?: string
    agentIdHandle?: string
    reaction?: number
    risk?: number
    wingColor?: string
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
    const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID)
    const chain = chainId === 97 ? bscTestnet : bsc
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
      verifierAddress: account.address,
      warning:
        'Format .ai valid. Verifikasi claim Binance Agent ID server-side belum diimplementasikan — permit ini hanya untuk BSC Testnet sampai verifikasi itu ada.',
    })
  } catch (e) {
    // Never leak the key or internal details; a chain-read failure means
    // no trustworthy nonce, so no signature is issued at all.
    return NextResponse.json(
      { error: 'Gagal membuat permit (verifier/chain tidak bisa dihubungi)' },
      { status: 503 },
    )
  }
}
