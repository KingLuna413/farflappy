'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAccount, useChainId, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseEther, parseEventLogs } from 'viem'
import {
  CONTRACTS_CONFIGURED,
  FLAP_PILOT_ADDRESS,
  FLAP_ARENA_ADDRESS,
  FLAP_PILOT_ABI,
  FLAP_ARENA_ABI,
  FLAP_PILOT_MINT_PRICE_BNB,
  FLAP_PILOT_MAX_SUPPLY,
  FLAP_PILOT_MAX_PER_WALLET,
} from '@/lib/bnb'
import { normalizeAgentIdHandle, agentIdHandleError } from '@/lib/agentId'

/**
 * Mint page (FarFlappy AI Arena, BNB Chain) — styled like other mint sites:
 * Step 1 connect wallet, Step 2 verify .ai + get a permit, Step 3 mint.
 *
 * The gate is enforced on-chain, not just in this UI: FlapPilot.mintAgent()
 * only accepts a mint whose permit signature recovers to the server verifier
 * and whose handle ends in ".ai". A plain wallet without a ".ai" Agent ID
 * cannot mint through this page, and bypassing the UI does not help —
 * the contract itself rejects a bad/missing permit.
 *
 * No fake transactions: the Mint button stays disabled until (a) contract
 * addresses are configured, (b) a wallet is connected, and (c) a permit
 * was issued for THIS wallet + THIS handle + THESE traits. If the verifier
 * is not configured, /api/mint/permit answers 503 and this page says so.
 */
interface Permit {
  signature: `0x${string}`
  nonce: number
  walletAddress: string
  agentIdHandle: string
  reaction: number
  risk: number
  wingColor: string
  warning?: string
}

export default function MintPage() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const [reaction, setReaction] = useState(50)
  const [risk, setRisk] = useState(50)
  const [wingColor, setWingColor] = useState('gold')
  const [handle, setHandle] = useState('')
  const [permit, setPermit] = useState<Permit | null>(null)
  const [permitLoading, setPermitLoading] = useState(false)
  const [permitError, setPermitError] = useState('')
  const [permitWarning, setPermitWarning] = useState('')
  const [pilotId, setPilotId] = useState('')
  const [mintedTokenId, setMintedTokenId] = useState<string | null>(null)
  const [formError, setFormError] = useState('')

  const { data: mintHash, isPending: mintPending, writeContract: writeMint, error: mintError } = useWriteContract()
  const { data: claimHash, isPending: claimPending, writeContract: writeClaim, error: claimError } = useWriteContract()
  const mintReceipt = useWaitForTransactionReceipt({ hash: mintHash })
  const claimReceipt = useWaitForTransactionReceipt({ hash: claimHash })

  // The permit is only valid for the exact wallet + handle + traits it was issued for.
  const permitMatches =
    !!permit &&
    !!address &&
    permit.walletAddress.toLowerCase() === address.toLowerCase() &&
    permit.agentIdHandle === normalizeAgentIdHandle(handle) &&
    permit.reaction === reaction &&
    permit.risk === risk &&
    permit.wingColor === wingColor
  const handleError = handle ? agentIdHandleError(handle) : null

  useEffect(() => {
    if (!mintReceipt.isSuccess || !mintReceipt.data) return
    try {
      const logs = parseEventLogs({
        abi: FLAP_PILOT_ABI,
        logs: mintReceipt.data.logs,
        eventName: 'PilotMintedAgent',
      })
      if (logs.length > 0) setMintedTokenId(String(logs[0].args.tokenId))
    } catch {
      // Token ID stays unknown; tx hash is still shown, nothing is faked.
    }
  }, [mintReceipt.isSuccess, mintReceipt.data])

  const handleRequestPermit = async () => {
    setPermitError('')
    setPermitWarning('')
    setPermit(null)
    const err = agentIdHandleError(handle)
    if (err) { setPermitError(err); return }
    if (!isConnected || !address) { setPermitError('Hubungkan wallet dulu.'); return }
    setPermitLoading(true)
    try {
      const res = await fetch('/api/mint/permit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: address, agentIdHandle: normalizeAgentIdHandle(handle), reaction, risk, wingColor }),
      })
      const data = await res.json()
      if (!res.ok) {
        setPermitError(data.error || 'Gagal meminta permit.')
        return
      }
      setPermit(data as Permit)
      if (data.warning) setPermitWarning(data.warning)
    } catch {
      setPermitError('Gagal menghubungi server permit.')
    } finally {
      setPermitLoading(false)
    }
  }

  const handleMint = () => {
    setFormError('')
    if (!isConnected || !address) { setFormError('Hubungkan wallet dulu.'); return }
    if (!FLAP_PILOT_ADDRESS) { setFormError('Alamat kontrak FlapPilot belum diset.'); return }
    if (!permitMatches || !permit) { setFormError('Minta permit .ai dulu (Langkah 2).'); return }
    writeMint({
      address: FLAP_PILOT_ADDRESS,
      abi: FLAP_PILOT_ABI,
      functionName: 'mintAgent',
      args: [reaction, risk, wingColor, permit.agentIdHandle, permit.signature],
      value: parseEther(FLAP_PILOT_MINT_PRICE_BNB),
    })
  }

  const handleClaim = () => {
    setFormError('')
    const id = Number(pilotId)
    if (!Number.isInteger(id) || id <= 0) { setFormError('Masukkan Pilot token ID yang valid.'); return }
    if (!FLAP_ARENA_ADDRESS) { setFormError('Alamat kontrak FlapArena belum diset.'); return }
    writeClaim({
      address: FLAP_ARENA_ADDRESS,
      abi: FLAP_ARENA_ABI,
      functionName: 'claimReward',
      args: [BigInt(id)],
    })
  }

  const shareText = mintedTokenId && permit
    ? `I'm Agent ${permit.agentIdHandle} — I just minted my FlapPilot #${mintedTokenId} in FarFlappy AI Arena on BNB Chain. Verified replays only. Who's your pilot?`
    : null

  return (
    <div style={{ minHeight: '100vh', background: '#0a0614', color: '#e2d9f3', fontFamily: '"IBM Plex Mono", monospace', padding: '32px 16px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <Link href="/" style={{ color: '#a78bfa', fontSize: 11 }}>← Kembali ke beranda</Link>
        <h1 style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 18, color: '#f5d020', marginTop: 20 }}>
          MINT FLAPPILOT · KLAIM $FLAP
        </h1>
        <p style={{ fontSize: 12, color: '#7c6fa0', lineHeight: 1.8 }}>
          FlapPilot adalah NFT di BNB Chain — tiket masuk Agent League.
          Max supply {FLAP_PILOT_MAX_SUPPLY.toLocaleString()}, harga {FLAP_PILOT_MINT_PRICE_BNB} BNB,
          maks {FLAP_PILOT_MAX_PER_WALLET} per wallet.
        </p>
        <p style={{ fontSize: 11, color: '#ef4444', lineHeight: 1.8 }}>
          ⚠️ Mint HANYA untuk agent wallet dengan handle .ai (Binance Agent ID,
          contoh: luna404.ai). Wallet biasa tanpa .ai tidak bisa mint — gate ini
          dicek di kontrak, bukan cuma di halaman ini.
        </p>

        {!CONTRACTS_CONFIGURED && (
          <div style={{ background: 'rgba(245,208,32,0.1)', border: '1px solid rgba(245,208,32,0.4)', padding: 16, marginTop: 20 }}>
            <div style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 10, color: '#f5d020' }}>
              ⚠️ KONTRAK BELUM DISET
            </div>
            <p style={{ fontSize: 11, color: '#7c6fa0', lineHeight: 1.8, marginTop: 10 }}>
              Alamat kontrak belum diisi di env
              (NEXT_PUBLIC_FLAP_PILOT_ADDRESS / NEXT_PUBLIC_FLAP_TOKEN_ADDRESS /
              NEXT_PUBLIC_FLAP_ARENA_ADDRESS). Halaman ini tidak akan mengirim
              transaksi apa pun sampai alamat tersebut diisi dari deployment
              BSC Testnet yang nyata. Status: kode saja, belum deploy, belum audit.
            </p>
          </div>
        )}

        {/* STEP 1 — CONNECT */}
        <section style={{ background: '#111028', border: '1px solid rgba(124,58,237,0.3)', padding: 20, marginTop: 20 }}>
          <h2 style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 11, color: '#a78bfa' }}>LANGKAH 1 · CONNECT WALLET</h2>
          {isConnected ? (
            <p style={{ fontSize: 11, color: '#10b981', wordBreak: 'break-all', marginTop: 12 }}>
              ✓ Terhubung: {address} {chainId ? `(chain ${chainId})` : ''}
            </p>
          ) : (
            <p style={{ fontSize: 11, color: '#7c6fa0', marginTop: 12 }}>
              Hubungkan wallet BNB Chain (chain 56, atau BSC Testnet 97 untuk testing) dari halaman Play.
            </p>
          )}
        </section>

        {/* STEP 2 — .AI VERIFY + PERMIT */}
        <section style={{ background: '#111028', border: '1px solid rgba(6,182,212,0.3)', padding: 20, marginTop: 16 }}>
          <h2 style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 11, color: '#06b6d4' }}>LANGKAH 2 · VERIFIKASI .AI</h2>
          <p style={{ fontSize: 11, color: '#7c6fa0', lineHeight: 1.8, marginTop: 10 }}>
            Klaim handle .ai dulu di Binance App (Web3 wallet → Agent ID), lalu
            masukkan handle yang sama di sini. Server akan menandatangani permit
            satu kali pakai untuk wallet + handle + trait ini.
          </p>
          <label style={{ display: 'block', marginTop: 12, fontSize: 11 }}>Handle Agent ID (.ai)</label>
          <input
            value={handle}
            onChange={(e) => { setHandle(e.target.value); setPermit(null) }}
            placeholder="contoh: luna404.ai"
            style={{ width: '100%', padding: 10, background: '#0a0614', color: '#e2d9f3', border: '1px solid #06b6d4' }}
          />
          {handleError && <p style={{ fontSize: 11, color: '#ef4444' }}>{handleError}</p>}
          <label style={{ display: 'block', marginTop: 16, fontSize: 11 }}>Reaksi (0–100): {reaction}</label>
          <input type="range" min={0} max={100} value={reaction} onChange={(e) => { setReaction(Number(e.target.value)); setPermit(null) }} style={{ width: '100%' }} />
          <label style={{ display: 'block', marginTop: 12, fontSize: 11 }}>Risiko (0–100): {risk}</label>
          <input type="range" min={0} max={100} value={risk} onChange={(e) => { setRisk(Number(e.target.value)); setPermit(null) }} style={{ width: '100%' }} />
          <label style={{ display: 'block', marginTop: 12, fontSize: 11 }}>Warna sayap</label>
          <select value={wingColor} onChange={(e) => { setWingColor(e.target.value); setPermit(null) }} style={{ width: '100%', padding: 10, background: '#0a0614', color: '#e2d9f3', border: '1px solid #7c3aed' }}>
            {['gold', 'violet', 'cyan', 'emerald', 'crimson'].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button
            onClick={handleRequestPermit}
            disabled={!isConnected || !!handleError || !handle || permitLoading}
            style={{ marginTop: 16, width: '100%', background: '#06b6d4', color: '#0a0614', border: 'none', cursor: 'pointer', fontFamily: '"Press Start 2P", monospace', fontSize: 10, padding: '14px' }}
          >
            {permitLoading ? 'MEMINTA PERMIT…' : 'MINTA PERMIT .AI'}
          </button>
          {permitMatches && (
            <p style={{ fontSize: 11, color: '#10b981', marginTop: 12 }}>
              ✓ ELIGIBLE — permit didapat untuk {permit?.agentIdHandle} (nonce {permit?.nonce}).
              Ganti wallet, handle, atau trait akan membatalkan permit ini.
            </p>
          )}
          {permitWarning && <p style={{ fontSize: 11, color: '#f5d020', lineHeight: 1.8 }}>{permitWarning}</p>}
          {permitError && <p style={{ fontSize: 11, color: '#ef4444' }}>{permitError}</p>}
        </section>

        {/* STEP 3 — MINT */}
        <section style={{ background: '#111028', border: '1px solid rgba(124,58,237,0.3)', padding: 20, marginTop: 16 }}>
          <h2 style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 11, color: '#a78bfa' }}>LANGKAH 3 · MINT</h2>
          <button
            onClick={handleMint}
            disabled={!CONTRACTS_CONFIGURED || !isConnected || !permitMatches || mintPending}
            style={{ marginTop: 16, width: '100%', background: '#7c3aed', color: 'white', border: 'none', cursor: 'pointer', fontFamily: '"Press Start 2P", monospace', fontSize: 10, padding: '14px' }}
          >
            {mintPending ? 'MENUNGGU WALLET…' : `MINT FLAPPILOT — ${FLAP_PILOT_MINT_PRICE_BNB} BNB`}
          </button>
          {!permitMatches && <p style={{ fontSize: 11, color: '#7c6fa0', marginTop: 10 }}>Tombol Mint aktif hanya setelah permit .ai didapat (Langkah 2).</p>}
          {mintHash && <p style={{ fontSize: 11, wordBreak: 'break-all', color: '#10b981' }}>Tx: {mintHash} {mintReceipt.isSuccess ? '✓ terkonfirmasi' : ''}</p>}
          {mintError && <p style={{ fontSize: 11, color: '#ef4444' }}>{mintError.message}</p>}
          {mintReceipt.isSuccess && (
            <div style={{ marginTop: 12, border: '1px solid rgba(16,185,129,0.4)', padding: 12 }}>
              <p style={{ fontSize: 11, color: '#10b981' }}>
                ✓ Mint berhasil{permit ? ` — Agent ${permit.agentIdHandle}` : ''}{mintedTokenId ? `, FlapPilot #${mintedTokenId}` : ', token ID ada di event transaksi'}.
                Trait: reaksi {reaction}, risiko {risk}, sayap {wingColor}.
              </p>
              {shareText && (
                <>
                  <p style={{ fontSize: 11, color: '#7c6fa0', marginTop: 10 }}>Teks share untuk X (salin sendiri):</p>
                  <p style={{ fontSize: 11, color: '#e2d9f3', lineHeight: 1.8, background: '#0a0614', padding: 10 }}>{shareText}</p>
                </>
              )}
            </div>
          )}
        </section>

        <section style={{ background: '#111028', border: '1px solid rgba(16,185,129,0.3)', padding: 20, marginTop: 16 }}>
          <h2 style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 11, color: '#10b981' }}>KLAIM $FLAP</h2>
          <p style={{ fontSize: 11, color: '#7c6fa0', lineHeight: 1.8 }}>
            Reward hanya berasal dari skor replay yang terverifikasi
            (POST /api/agent/replay). Klaim membagi reward sesuai delegasi
            Pilot yang tercatat di kontrak, jika ada.
          </p>
          <input
            value={pilotId}
            onChange={(e) => setPilotId(e.target.value)}
            placeholder="Pilot token ID, mis. 1"
            style={{ width: '100%', padding: 10, background: '#0a0614', color: '#e2d9f3', border: '1px solid #10b981' }}
          />
          <button
            onClick={handleClaim}
            disabled={!CONTRACTS_CONFIGURED || !isConnected || claimPending}
            style={{ marginTop: 12, width: '100%', background: '#10b981', color: '#0a0614', border: 'none', cursor: 'pointer', fontFamily: '"Press Start 2P", monospace', fontSize: 10, padding: '14px' }}
          >
            {claimPending ? 'MENUNGGU WALLET…' : 'KLAIM $FLAP'}
          </button>
          {claimHash && <p style={{ fontSize: 11, wordBreak: 'break-all', color: '#10b981' }}>Tx: {claimHash} {claimReceipt.isSuccess ? '✓ terkonfirmasi' : ''}</p>}
          {claimError && <p style={{ fontSize: 11, color: '#ef4444' }}>{claimError.message}</p>}
          {formError && <p style={{ fontSize: 11, color: '#ef4444' }}>{formError}</p>}
        </section>
      </div>
    </div>
  )
}
