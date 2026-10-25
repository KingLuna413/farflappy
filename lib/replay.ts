/**
 * Proof-of-Play replay verification (v1) — FarFlappy AI Arena.
 *
 * IDEA: an agent does NOT just POST a score. It runs the game headless with
 * a fixed seed and records every flap as a frame number. It sends
 * { seed, flapFrames, claimedScore, ... } to /api/agent/replay. The server
 * re-runs THIS simulation and only accepts the score if the simulated
 * score, pipes passed, and hash all match. A made-up score cannot pass,
 * because the server does not trust the claim — it replays the game.
 *
 * ⚠️  V1 LIMITATION — READ BEFORE PRODUCTION:
 * This simulation covers ONLY the core physics shared with GameEngine:
 * gravity 0.35, jump force -7, bird x=80, bird size 28, pipe width 52,
 * pipe speed per mode (easy 0.7 / medium 1.5 / expert 2.8 / insane 4.5),
 * pipe gap per mode (195 / 165 / 135 / 105), score 10 per pipe,
 * canvas 390x600 with ground at height-40, and the pipe spawn interval
 * max(80, 130 - pipesPassed * 0.4).
 *
 * It does NOT yet simulate: coins, power-up items, magnet, double/flash
 * multipliers, tournament speed tiers, or the browser GameEngine's exact
 * Math.random() sequence (coin chains and item spawns consume extra
 * random draws). Therefore:
 *  - v1 replays must be produced by a headless runner that uses THIS
 *    file's PRNG (mulberry32) and pipe sequence, not by recording random
 *    draws from the browser canvas engine;
 *  - v1 replays with coinsCollected > 0 are REJECTED (coins are not simulated);
 *  - before mainnet rewards, the full pipe/coin/item physics MUST be
 *    aligned exactly with components/game/GameEngine.tsx, and v1 replays
 *    must be re-validated against that aligned simulator.
 */

export type GameMode = 'easy' | 'medium' | 'expert' | 'insane'

export const REPLAY_GRAVITY = 0.35
export const REPLAY_JUMP_FORCE = -7
export const REPLAY_BIRD_X = 80
export const REPLAY_BIRD_SIZE = 28
export const REPLAY_PIPE_WIDTH = 52
export const REPLAY_CANVAS_WIDTH = 390
export const REPLAY_CANVAS_HEIGHT = 600
export const REPLAY_GROUND_Y = REPLAY_CANVAS_HEIGHT - 40
export const REPLAY_SCORE_PER_PIPE = 10

export const REPLAY_MODE_SPEED: Record<GameMode, number> = {
  easy: 0.7,
  medium: 1.5,
  expert: 2.8,
  insane: 4.5,
}

export const REPLAY_MODE_GAP: Record<GameMode, number> = {
  easy: 195,
  medium: 165,
  expert: 135,
  insane: 105,
}

export interface Replay {
  version: 1
  /** Deterministic seed for pipe generation. Must be an integer. */
  seed: number
  gameMode: GameMode
  /** Frame numbers (0-based) on which the agent flapped. Must be sorted ascending. */
  flapFrames: number[]
  /** Total number of simulated frames in this run. */
  durationFrames: number
  claimedScore: number
  pipesPassed: number
  /** v1: must be 0, because coins are not simulated yet (see header). */
  coinsCollected: number
  /** Optional: Pilot token id the agent played with (Agent League ticket). */
  pilotTokenId?: number
  /** Optional: agent wallet address, for leaderboard attribution. */
  walletAddress?: string
}

export interface VerifyResult {
  valid: boolean
  simulatedScore: number
  simulatedPipes: number
  reason?: string
}

/** Deterministic PRNG (mulberry32). Same seed => same pipe sequence, everywhere. */
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return function next() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function canonicalReplayString(replay: Replay): string {
  return [
    replay.version,
    replay.seed,
    replay.gameMode,
    replay.durationFrames,
    replay.claimedScore,
    replay.pipesPassed,
    replay.coinsCollected,
    replay.flapFrames.join(','),
  ].join('|')
}

/**
 * SHA-256 hash of the canonical replay string. Uses the platform WebCrypto
 * (available in browsers and in Node 18+), so client and server agree.
 */
export async function hashReplay(replay: Replay): Promise<string> {
  const data = new TextEncoder().encode(canonicalReplayString(replay))
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Re-run the v1 deterministic simulation and compare with the claim.
 * Returns valid=false with a reason on ANY mismatch — never trust the claim.
 */
export function verifyReplay(replay: Replay): VerifyResult {
  if (replay.version !== 1) return { valid: false, simulatedScore: 0, simulatedPipes: 0, reason: 'unsupported replay version' }
  if (!Number.isInteger(replay.seed)) return { valid: false, simulatedScore: 0, simulatedPipes: 0, reason: 'seed must be an integer' }
  if (!REPLAY_MODE_SPEED[replay.gameMode]) return { valid: false, simulatedScore: 0, simulatedPipes: 0, reason: 'unknown game mode' }
  if (replay.coinsCollected !== 0) return { valid: false, simulatedScore: 0, simulatedPipes: 0, reason: 'v1 replays must have coinsCollected = 0 (coins not simulated yet)' }
  if (replay.durationFrames <= 0 || replay.durationFrames > 200_000) return { valid: false, simulatedScore: 0, simulatedPipes: 0, reason: 'durationFrames out of range' }
  const sorted = [...replay.flapFrames].sort((a, b) => a - b)
  if (sorted.length !== replay.flapFrames.length || sorted.some((f, i) => f !== replay.flapFrames[i] || !Number.isInteger(f) || f < 0 || f >= replay.durationFrames)) {
    return { valid: false, simulatedScore: 0, simulatedPipes: 0, reason: 'flapFrames must be sorted integers inside durationFrames' }
  }
  if (replay.claimedScore < 0 || replay.pipesPassed < 0) return { valid: false, simulatedScore: 0, simulatedPipes: 0, reason: 'negative score or pipes' }
  if (replay.claimedScore !== replay.pipesPassed * REPLAY_SCORE_PER_PIPE) {
    return { valid: false, simulatedScore: 0, simulatedPipes: 0, reason: 'v1 claimedScore must equal pipesPassed * 10 (no coin/item multipliers yet)' }
  }

  const rand = mulberry32(replay.seed)
  const speed = REPLAY_MODE_SPEED[replay.gameMode]
  const gap = REPLAY_MODE_GAP[replay.gameMode]
  const flapSet = new Set(replay.flapFrames)

  let birdY = 200
  let vy = 0
  let pipesPassed = 0
  let score = 0
  let pipeTimer = 0
  let alive = true
  interface SimPipe { x: number; topHeight: number }
  const pipes: SimPipe[] = []

  for (let frame = 0; frame < replay.durationFrames; frame++) {
    if (flapSet.has(frame)) vy = REPLAY_JUMP_FORCE
    vy += REPLAY_GRAVITY
    birdY += vy

    pipeTimer++
    const pipeInterval = Math.max(80, 130 - pipesPassed * 0.4)
    if (pipeTimer >= pipeInterval) {
      pipeTimer = 0
      const topHeight = 60 + rand() * (REPLAY_CANVAS_HEIGHT - gap - 100)
      pipes.push({ x: REPLAY_CANVAS_WIDTH, topHeight })
    }

    for (let i = pipes.length - 1; i >= 0; i--) {
      const pipe = pipes[i]
      pipe.x -= speed
      if (pipe.x + REPLAY_PIPE_WIDTH < REPLAY_BIRD_X) {
        // Count a pipe once, when it fully passes the bird — same rule as GameEngine.
        if (!((pipe as SimPipe & { passed?: boolean }).passed)) {
          ;(pipe as SimPipe & { passed?: boolean }).passed = true
          pipesPassed++
          score += REPLAY_SCORE_PER_PIPE
        }
      }
      if (pipe.x + REPLAY_PIPE_WIDTH <= -10) pipes.splice(i, 1)
    }

    // Collision — same bounds as GameEngine.checkCollision (pipes + ceiling + ground).
    let collided = false
    if (birdY <= 0 || birdY + REPLAY_BIRD_SIZE >= REPLAY_GROUND_Y) collided = true
    if (!collided) {
      for (const pipe of pipes) {
        if (
          REPLAY_BIRD_X + REPLAY_BIRD_SIZE - 8 > pipe.x + 4 &&
          REPLAY_BIRD_X + 8 < pipe.x + REPLAY_PIPE_WIDTH - 4 &&
          (birdY + 8 < pipe.topHeight || birdY + REPLAY_BIRD_SIZE - 8 > pipe.topHeight + gap)
        ) {
          collided = true
          break
        }
      }
    }
    if (collided) {
      alive = false
      break
    }
  }

  if (alive) return { valid: false, simulatedScore: score, simulatedPipes: pipesPassed, reason: 'replay did not end in death within durationFrames — a complete run must terminate' }
  if (score !== replay.claimedScore) return { valid: false, simulatedScore: score, simulatedPipes: pipesPassed, reason: `simulated score ${score} != claimed ${replay.claimedScore}` }
  if (pipesPassed !== replay.pipesPassed) return { valid: false, simulatedScore: score, simulatedPipes: pipesPassed, reason: `simulated pipes ${pipesPassed} != claimed ${replay.pipesPassed}` }
  return { valid: true, simulatedScore: score, simulatedPipes: pipesPassed }
}
