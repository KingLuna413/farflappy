import { NextRequest, NextResponse } from 'next/server'
import { hashReplay, verifyReplay, type Replay } from '@/lib/replay'

/**
 * POST /api/agent/replay — the official Agent League path (FarFlappy AI Arena).
 *
 * The OLD endpoint (POST /api/agent action=submit_score) is intentionally
 * left untouched for backwards compatibility, but it trusts a raw score.
 * THIS endpoint does not: a score is only recorded if the replay replays
 * to the exact same score on the server. Unverified scores are rejected
 * with 422 and never reach the score tables.
 *
 * Body:
 *   { replay: Replay, replayHash?: string, walletAddress?: string,
 *     tournament_id?: string, game_mode?: string }
 *
 * If replayHash is supplied it must equal hashReplay(replay), otherwise 400.
 * If Supabase is not configured, a verified replay is returned as
 * verified=true, stored=false (honest, no fake persistence). If a wallet
 * address is supplied and Supabase is configured, the verified score is
 * recorded with the same tables as the legacy flow (game_sessions +
 * upsert_daily_score + players totals). Replay-hash de-duplication in the
 * database still requires a migration adding a replay_hash column — see
 * README "Belum selesai". On-chain reward accrual (FlapArena) happens
 * separately via the trusted verifier, not from this endpoint alone.
 */
export async function POST(req: NextRequest) {
  let body: { replay?: Replay; replayHash?: string; walletAddress?: string; tournament_id?: string; game_mode?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const replay = body.replay
  if (!replay || typeof replay !== 'object') {
    return NextResponse.json({ error: 'replay is required' }, { status: 400 })
  }

  if (body.replayHash) {
    const expected = await hashReplay(replay)
    if (expected !== body.replayHash) {
      return NextResponse.json({ error: 'replayHash mismatch', expected }, { status: 400 })
    }
  }

  const result = verifyReplay(replay)
  if (!result.valid) {
    return NextResponse.json(
      { verified: false, error: result.reason, simulatedScore: result.simulatedScore, simulatedPipes: result.simulatedPipes },
      { status: 422 },
    )
  }

  const replayHash = body.replayHash || (await hashReplay(replay))
  const walletAddress = body.walletAddress || replay.walletAddress

  // No wallet => verified only, no attribution. No Supabase => verified only.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!walletAddress || !supabaseUrl || !serviceKey) {
    return NextResponse.json({
      verified: true,
      stored: false,
      score: result.simulatedScore,
      pipesPassed: result.simulatedPipes,
      replayHash,
      note: !walletAddress
        ? 'Verified, but no walletAddress supplied so nothing was recorded.'
        : 'Verified, but Supabase is not configured so nothing was persisted.',
    })
  }

  try {
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(supabaseUrl, serviceKey)
    const { data: player } = await supabase
      .from('players')
      .select('id, total_score, games_played')
      .eq('wallet_address', walletAddress.toLowerCase())
      .single()

    if (!player) {
      return NextResponse.json({
        verified: true,
        stored: false,
        score: result.simulatedScore,
        pipesPassed: result.simulatedPipes,
        replayHash,
        note: 'Verified, but no player row for this wallet. Register via POST /api/agent action=register first.',
      })
    }

    await supabase.from('game_sessions').insert({
      player_id: player.id,
      score: result.simulatedScore,
      pipes_passed: result.simulatedPipes,
      coins_collected: 0,
      duration_seconds: Math.round(replay.durationFrames / 60),
      session_type: body.tournament_id ? 'tournament' : 'casual',
      tournament_id: body.tournament_id || null,
      attempt_number: 1,
      game_mode: replay.gameMode,
    })
    await supabase.rpc('upsert_daily_score', { p_player_id: player.id, p_player_type: 'agent', p_score: result.simulatedScore })
    await supabase
      .from('players')
      .update({ total_score: player.total_score + result.simulatedScore, games_played: player.games_played + 1 })
      .eq('id', player.id)

    return NextResponse.json({
      verified: true,
      stored: true,
      score: result.simulatedScore,
      pipesPassed: result.simulatedPipes,
      replayHash,
    })
  } catch (e) {
    return NextResponse.json(
      { verified: true, stored: false, score: result.simulatedScore, error: e instanceof Error ? e.message : 'storage failed' },
      { status: 500 },
    )
  }
}
