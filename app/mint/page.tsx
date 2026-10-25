'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseEther } from 'viem'
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

/**
 * Mint + claim page (FarFlappy AI Arena, BNB Chain).
 * If contract addresses are not set in env, this page shows a configuration
 * message and NEVER attempts a transaction. No fake mint, no fake claim.
 */
export default function MintPage() {
  const { address, isConnected } = useAccount()
  const [reaction, setReaction] = useState(50)
  const [risk, setRisk] = useState(50)
  const [wingColor, setWingColor] = useState('gold')
  const [pilotId, setPilotId] = useState('')
  const [formError, setFormError] = useState('')

  const { data: mintHash, isPending: mintPending, writeContract: writeMint, error: mintError } = useWriteContract()
  const { data: claimHash, isPending: claimPending, writeContract: writeClaim, error: claimError } = useWriteContract()
  const mintReceipt = useWaitForTransactionReceipt({ hash: mintHash })
  const claimReceipt = useWaitForTransactionReceipt({ hash: claimHash })

  const handleMint = () => {
    setFormError('')
    if (!isConnected || !address) { setFormError('Hubungkan wallet dulu.'); return }
    if (!FLAP_PILOT_ADDRESS) { setFormError('Alamat kontrak FlapPilot belum diset.'); return }
    writeMint({
      address: FLAP_PILOT_ADDRESS,
      abi: FLAP_PILOT_ABI,
      functionName: 'mint',
      args: [reaction, risk, wingColor],
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
          maks {FLAP_PILOT_MAX_PER_WALLET} per wallet. Reputasi (skor terbaik terverifikasi)
          menempel di NFT, bukan di wallet.
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

        <section style={{ background: '#111028', border: '1px solid rgba(124,58,237,0.3)', padding: 20, marginTop: 20 }}>
          <h2 style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 11, color: '#a78bfa' }}>1 · MINT FLAPPILOT</h2>
          <label style={{ display: 'block', marginTop: 16, fontSize: 11 }}>Reaksi (0–100): {reaction}</label>
          <input type="range" min={0} max={100} value={reaction} onChange={(e) => setReaction(Number(e.target.value))} style={{ width: '100%' }} />
          <label style={{ display: 'block', marginTop: 12, fontSize: 11 }}>Risiko (0–100): {risk}</label>
          <input type="range" min={0} max={100} value={risk} onChange={(e) => setRisk(Number(e.target.value))} style={{ width: '100%' }} />
          <label style={{ display: 'block', marginTop: 12, fontSize: 11 }}>Warna sayap</label>
          <select value={wingColor} onChange={(e) => setWingColor(e.target.value)} style={{ width: '100%', padding: 10, background: '#0a0614', color: '#e2d9f3', border: '1px solid #7c3aed' }}>
            {['gold', 'violet', 'cyan', 'emerald', 'crimson'].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button
            onClick={handleMint}
            disabled={!CONTRACTS_CONFIGURED || !isConnected || mintPending}
            style={{ marginTop: 16, width: '100%', background: '#7c3aed', color: 'white', border: 'none', cursor: 'pointer', fontFamily: '"Press Start 2P", monospace', fontSize: 10, padding: '14px' }}
          >
            {mintPending ? 'MENUNGGU WALLET…' : `MINT — ${FLAP_PILOT_MINT_PRICE_BNB} BNB`}
          </button>
          {mintHash && <p style={{ fontSize: 11, wordBreak: 'break-all', color: '#10b981' }}>Tx: {mintHash} {mintReceipt.isSuccess ? '✓ terkonfirmasi' : ''}</p>}
          {mintError && <p style={{ fontSize: 11, color: '#ef4444' }}>{mintError.message}</p>}
        </section>

        <section style={{ background: '#111028', border: '1px solid rgba(16,185,129,0.3)', padding: 20, marginTop: 16 }}>
          <h2 style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 11, color: '#10b981' }}>2 · KLAIM $FLAP</h2>
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

        {!isConnected && (
          <p style={{ fontSize: 11, color: '#7c6fa0', marginTop: 16 }}>
            Hubungkan wallet BNB Chain (chain 56, atau BSC Testnet 97 untuk testing) dari halaman Play.
          </p>
        )}
      </div>
    </div>
  )
}
