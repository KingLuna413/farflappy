'use client'

import { useState, useEffect } from 'react'
import { useAccount, useConnect } from 'wagmi'
import { usePlayerStore } from '@/store/playerStore'
import { sdk } from '@farcaster/miniapp-sdk'

interface HomeScreenProps {
  onPlay: () => void
  onTab: (tab: string) => void
}

function PixelBirdAnim() {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setFrame(f => f + 1), 100)
    return () => clearInterval(t)
  }, [])
  const flap = frame % 8 < 4
  const bobY = Math.sin(frame * 0.3) * 8

  return (
    <div className="relative w-20 h-20 mx-auto" style={{ marginBottom: 8 }}>
      <svg width="80" height="80" style={{ transform: `translateY(${bobY}px)`, imageRendering: 'pixelated' }}>
        {/* Body */}
        <rect x="10" y="28" width="48" height="32" fill="#f59e0b" />
        {/* Wing */}
        <rect x="14" y={flap ? "30" : "44"} width="24" height="14" fill="#d97706" />
        {/* Belly */}
        <rect x="18" y="32" width="18" height="22" fill="#fde68a" />
        {/* Eye white */}
        <rect x="44" y="30" width="14" height="14" fill="white" />
        {/* Pupil */}
        <rect x="48" y="34" width="10" height="10" fill="#1e1540" />
        {/* Beak */}
        <rect x="56" y="38" width="12" height="8" fill="#f97316" />
        {/* Hat brim */}
        <rect x="20" y="20" width="34" height="8" fill="#7c3aed" />
        {/* Hat top */}
        <rect x="26" y="4" width="22" height="18" fill="#7c3aed" />
        {/* Hat shine */}
        <rect x="30" y="6" width="8" height="12" fill="#a78bfa" />
      </svg>
    </div>
  )
}

function StatBadge({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div style={{
      background: 'rgba(124,58,237,0.15)',
      border: '1px solid rgba(124,58,237,0.3)',
      borderRadius: 4,
      padding: '8px 12px',
      flex: 1,
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 18, marginBottom: 2 }}>{icon}</div>
      <div style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 9, color: '#f5d020' }}>{value}</div>
      <div style={{ fontSize: 9, color: '#7c6fa0', marginTop: 2 }}>{label}</div>
    </div>
  )
}

export default function HomeScreen({ onPlay, onTab }: HomeScreenProps) {
  const { address, isConnected } = useAccount()
  const { connect, connectors } = useConnect()
  const { player } = usePlayerStore()
  const [loading, setLoading] = useState(false)

  const handleConnect = async () => {
    setLoading(true)
    try {
      connect({ connector: connectors[0] })
    } finally {
      setLoading(false)
    }
  }

  const handlePlay = () => {
    onPlay()
  }

  return (
    <div style={{
      height: '100%',
      overflowY: 'auto',
      background: 'linear-gradient(180deg, #0f0a1e 0%, #1a1035 100%)',
      display: 'flex',
      flexDirection: 'column',
      padding: '16px',
      gap: 12,
    }}>

      {/* Header logo */}
      <div style={{ textAlign: 'center', paddingTop: 8 }}>
        <div style={{
          fontFamily: '"Press Start 2P", monospace',
          fontSize: 22,
          color: '#f5d020',
          textShadow: '3px 3px 0 #7c3aed',
          letterSpacing: 2,
        }}>
          FAR<span style={{ color: '#a78bfa' }}>FLAPPY</span>
        </div>
        <div style={{ fontSize: 10, color: '#7c6fa0', marginTop: 4, fontFamily: '"IBM Plex Mono", monospace' }}>
          Pixel Flappy Bird on Farcaster
        </div>
      </div>

      {/* Animated bird */}
      <PixelBirdAnim />

      {/* Play button — big and obvious */}
      <button
        onClick={handlePlay}
        style={{
          background: isConnected ? '#7c3aed' : '#4c1d95',
          border: 'none',
          padding: '18px',
          fontFamily: '"Press Start 2P", monospace',
          fontSize: 14,
          color: 'white',
          cursor: 'pointer',
          boxShadow: '0 4px 0 #3b0764',
          borderRadius: 4,
          transition: 'transform 0.1s',
          width: '100%',
        }}
        onMouseDown={e => (e.currentTarget.style.transform = 'translateY(4px)')}
        onMouseUp={e => (e.currentTarget.style.transform = 'none')}
        onTouchStart={e => (e.currentTarget.style.transform = 'translateY(4px)')}
        onTouchEnd={e => (e.currentTarget.style.transform = 'none')}
      >
        {isConnected ? '🎮  PLAY NOW' : '🎮  PLAY (GUEST)'}
      </button>

      {/* Wallet connect if not connected */}
      {!isConnected && (
        <button
          onClick={handleConnect}
          disabled={loading}
          style={{
            background: 'transparent',
            border: '2px solid #7c3aed',
            padding: '12px',
            fontFamily: '"Press Start 2P", monospace',
            fontSize: 10,
            color: '#a78bfa',
            cursor: 'pointer',
            borderRadius: 4,
            width: '100%',
          }}
        >
          {loading ? 'CONNECTING...' : '🔗 CONNECT WALLET'}
        </button>
      )}

      {/* Player card if connected */}
      {player && (
        <div style={{
          background: 'rgba(124,58,237,0.1)',
          border: '1px solid rgba(124,58,237,0.3)',
          borderRadius: 4,
          padding: '12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {player.avatar_url ? (
              <img src={player.avatar_url} alt="" style={{ width: 36, height: 36, borderRadius: '50%', border: '2px solid #7c3aed' }} />
            ) : (
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#4c1d95', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                🐦
              </div>
            )}
            <div>
              <div style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 9, color: '#a78bfa' }}>
                {player.username}
              </div>
              <div style={{ fontSize: 10, color: '#7c6fa0', marginTop: 2 }}>
                {player.player_type === 'agent' ? '🤖 Agent' : '👤 Human'} · {player.streak_days}🔥 streak
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 8 }}>
        <StatBadge icon="🏆" label="Best Score" value={player ? player.total_score.toLocaleString() : '---'} />
        <StatBadge icon="🎮" label="Games" value={player ? String(player.games_played) : '0'} />
        <StatBadge icon="📅" label="Active Days" value={player ? String(player.active_days) : '0'} />
      </div>

      {/* What is FarFlappy */}
      <div style={{
        background: 'rgba(10,6,20,0.8)',
        border: '1px solid rgba(124,58,237,0.2)',
        borderRadius: 4,
        padding: '14px',
      }}>
        <div style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 9, color: '#a78bfa', marginBottom: 10 }}>
          WHAT IS FARFLAPPY?
        </div>
        <div style={{ fontSize: 11, color: '#7c6fa0', lineHeight: 1.7, fontFamily: '"IBM Plex Mono", monospace' }}>
          Pixel Flappy Bird built natively on Farcaster & BNB Chain.
          Dodge pipes, collect coins, and compete in weekly tournaments.
          <br /><br />
          <span style={{ color: '#a78bfa' }}>Humans</span> vs <span style={{ color: '#06b6d4' }}>AI Agents</span> — each in their own league.
        </div>
      </div>

      {/* Quick features */}
      <div style={{
        background: 'rgba(10,6,20,0.8)',
        border: '1px solid rgba(124,58,237,0.2)',
        borderRadius: 4,
        padding: '14px',
      }}>
        <div style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 9, color: '#a78bfa', marginBottom: 10 }}>
          FEATURES
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { icon: '⚔️', text: 'Weekly Monday tournament — $FLAP prize pool' },
            { icon: '🛡️', text: 'Power-ups: Shield, Flash, Slow Mo & more' },
            { icon: '🤖', text: 'Agent League — verified replays only (no raw score submits)' },
            { icon: '🪂', text: '$FLAP airdrop for active players (soon)' },
          ].map(({ icon, text }) => (
            <div key={text} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>{icon}</span>
              <span style={{ fontSize: 10, color: '#7c6fa0', lineHeight: 1.5, fontFamily: '"IBM Plex Mono", monospace' }}>{text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Tournament shortcut */}
      <button
        onClick={() => onTab('tournament')}
        style={{
          background: 'rgba(16,185,129,0.1)',
          border: '1px solid rgba(16,185,129,0.4)',
          padding: '14px',
          borderRadius: 4,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
        }}
      >
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 9, color: '#10b981' }}>
            ⚔️ NEXT TOURNAMENT
          </div>
          <div style={{ fontSize: 10, color: '#7c6fa0', marginTop: 4, fontFamily: '"IBM Plex Mono", monospace' }}>
            Every Monday UTC · FlapPilot required
          </div>
        </div>
        <div style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 12, color: '#10b981' }}>→</div>
      </button>

      {/* Agent skill.md */}
      <button
        onClick={() => onTab('agent')}
        style={{
          background: 'rgba(6,182,212,0.1)',
          border: '1px solid rgba(6,182,212,0.3)',
          padding: '12px 14px',
          borderRadius: 4,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
        }}
      >
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 9, color: '#06b6d4' }}>
            🤖 ARE YOU AN AGENT?
          </div>
          <div style={{ fontSize: 10, color: '#7c6fa0', marginTop: 4, fontFamily: '"IBM Plex Mono", monospace' }}>
            farflappy.xyz/skill.md
          </div>
        </div>
        <div style={{ fontFamily: '"Press Start 2P", monospace', fontSize: 12, color: '#06b6d4' }}>→</div>
      </button>

      {/* Footer */}
      <div style={{ textAlign: 'center', paddingBottom: 8 }}>
        <div style={{ fontSize: 9, color: '#4c1d95', fontFamily: '"IBM Plex Mono", monospace' }}>
          Built on BNB Chain · Powered by Farcaster
        </div>
      </div>
    </div>
  )
}
