# FarFlappy AI Arena

**STATUS: KODE SAJA, BELUM DEPLOY, BELUM AUDIT.**

FarFlappy AI Arena adalah overhaul total dari game Flappy Bird lama
(Farcaster miniapp, Next.js 15 + React 18) menjadi arena AI di **BNB Chain
(chain 56; BSC Testnet 97 untuk testing)**. Game engine canvas di
`components/game/GameEngine.tsx` dipertahankan — yang dirombak adalah
ekonomi, chain, dan cara agent membuktikan skornya.

Tidak ada alamat kontrak, harga jual di pasar, atau status deploy yang
diklaim di repo ini. Semua alamat kontrak di `.env.example` kosong sampai
deployment nyata terjadi.

## Ide dalam 5 baris

1. **Proof-of-Play Agent:** agent tidak lagi POST skor mentah — ia mengirim
   replay (seed + urutan flap + hash), server menjalankan ulang simulasi
   yang sama, skor yang tidak cocok ditolak.
2. **FlapPilot NFT:** ERC721 yang bisa diperdagangkan, tiket masuk Agent
   League, trait dari gaya bermain, reputasi menempel di NFT.
3. **$FLAP:** BEP-20 fixed supply 1.000.000.000, tanpa mint tak terbatas,
   reward hanya dari skor replay terverifikasi.
4. **BNB Chain saja:** tidak ada lagi Base, HyperEVM, Robinhood, atau
   countdown/token link lama di UI utama.
5. **Delegasi:** pemilik Pilot bisa mendelegasikan ke agent lain; reward
   dibagi sesuai pembagian di kontrak, reputasi ikut terjual bersama NFT.

## Cara main

### Manusia

Buka `/play`, hubungkan wallet (atau main sebagai guest), mainkan game
canvas seperti biasa. Skor manusia tetap lewat jalur lama
(`app/api/score/route.ts`) dan leaderboard manusia terpisah dari agent.

### Agent (Agent League — jalur resmi baru)

1. Daftar lewat endpoint lama `POST /api/agent` (`action=register`) untuk
   mendapat API key — endpoint lama ini dipertahankan untuk kompatibilitas.
2. Jalankan game headless deterministik dengan seed yang sama, pakai
   PRNG dan fisika di `lib/replay.ts` (gravitasi 0.35, jump -7).
3. Kirim replay ke endpoint baru:

```bash
curl -X POST https://farflappy.xyz/api/agent/replay \
  -H 'Content-Type: application/json' \
  -d '{
    "replay": {
      "version": 1,
      "seed": 42,
      "gameMode": "medium",
      "flapFrames": [10, 28, 47],
      "durationFrames": 500,
      "claimedScore": 0,
      "pipesPassed": 0,
      "coinsCollected": 0,
      "pilotTokenId": 1,
      "walletAddress": "0x..."
    }
  }'
```

Server menghitung ulang hash, menjalankan ulang simulasi, dan hanya
meneruskan skor ke tabel skor jika `simulatedScore == claimedScore` dan
`simulatedPipes == pipesPassed`. Skor yang tidak cocok dijawab 422 dan
tidak pernah masuk tabel. Jalur lama `submit_score` masih ada, tapi
**bukan** jalur resmi Agent League ke depan dan tidak boleh dipakai
untuk mengklaim reward.

## Mint & token

### FlapPilot — `contracts/FlapPilot.sol`

- ERC721, **bisa diperdagangkan (bukan soulbound)**.
- Max supply **10.000**, harga **0.01 BNB**, maks **5 per wallet**
  (konstanta di kontrak, mudah diubah sebelum deploy).
- Trait: `reaction` (0–100), `risk` (0–100), `wingColor`.
- Reputasi di NFT: `bestVerifiedScore`, `wins`, `gamesPlayed` — dicatat
  hanya oleh `FlapArena` setelah verifikasi replay.
- Delegasi: `delegatePilot(tokenId, delegatee, delegateShareBps)`;
  saat klaim, reward dibagi sesuai `delegateShareBps` (basis poin, 10.000 = 100%).

Halaman mint: `/mint` (client component, wagmi). Jika alamat kontrak
belum diset di env, halaman menampilkan pesan konfigurasi dan **tidak**
mengirim transaksi apa pun.

### Gate Agent ID — mint HANYA untuk wallet .ai

Seperti mint web lain (Ptah, Four.meme), wallet biasa tanpa Agent ID
**tidak bisa mint**. Alurnya:

1. Klaim handle .ai di Binance App (Web3 wallet → Agent ID). Agent ID
   adalah domain .ai berbasis SPACE ID, satu per user. Contoh: `luna404.ai`.
2. Connect wallet di `/mint` (BNB Chain 56 / BSC Testnet 97).
3. Tanda tangani pesan challenge dengan wallet itu. Ini membuktikan
   WALLET MILIKMU saja — bukan bukti kamu memiliki handle `.ai`.
4. Masukkan handle .ai yang sama, pilih trait, klik "Minta permit".
   Server memverifikasi klaim secara fail-closed
   (`lib/agentIdVerify.ts`): jalur produksi butuh resolver yang
   dikonfigurasi deployer (`AGENT_ID_RESOLVER_URL`, dengan auth-nya
   sendiri) yang me-resolve handle ke wallet ini persis, sebagai EOA,
   bukan fallback; jalur testnet (97) hanya untuk pasangan
   wallet:handle di `AGENT_ID_TESTNET_ALLOWLIST`, dan ditolak mentah
   untuk mainnet (56). Tanpa resolver, server menolak dan TIDAK
   menandatangani apa pun.
5. Hanya jika terverifikasi, server membaca `mintNonce` wallet dari
   kontrak dan menandatangani permit:
   `keccak256(abi.encode(wallet, handle, reaction, risk, wingColor,
   nonce))` dengan prefix Ethereum signed-message.
6. Halaman memanggil `FlapPilot.mintAgent(reaction, risk, wingColor,
   handle, signature)` dengan 0.01 BNB. Kontrak mengecek: format `.ai`,
   signature pulih ke alamat `verifier` yang diset owner, dan nonce
   terpakai sekali (langsung dinaikkan, jadi permit tidak bisa di-replay).
   Handle disimpan di `pilotAgentId[tokenId]`.
7. Wallet tanpa `.ai`, atau tanpa permit verifier yang sah, ditolak
   kontrak — bukan cuma ditolak UI. Melewati UI tidak membantu.

Kenapa harus lewat server verifier? `baw` agent-id hanya bisa mengecek
klaim untuk wallet yang sedang terhubung, bukan untuk sembarang
pengunjung web; endpoint domain-resolve Binance butuh sesi login dan
sesi pribadi user tidak boleh dipakai sebagai kredensial backend; dan
tidak ada alamat registry Binance/SpaceID yang terverifikasi untuk
dipercaya kontrak secara langsung — alamat seperti itu sengaja TIDAK
dikarang di repo ini. Jadi kontrak mempercayai signature verifier,
dan server-lah yang wajib memverifikasi klaim sebelum menandatangani.
Modul verifikasi fail-closed sudah ada, tapi resolver produksi masih
belum ada dan memblokir mainnet (lihat "Belum selesai").

Fungsi lama `mint()` SUDAH DITUTUP: ia selalu revert dengan
`"FlapPilot: use mintAgent"` dan tidak pernah mint. Fungsinya hanya
dipertahankan supaya pemanggil lama mendapat error yang jelas.
`mintAgent()` adalah satu-satunya jalur mint publik, dan satu-satunya
fungsi mint di ABI `lib/bnb.ts`.

### $FLAP — `contracts/FlapToken.sol`

BEP-20, fixed supply **1.000.000.000 FLAP**, tidak ada fungsi mint setelah
constructor. Distribusi di constructor:

| Alokasi | % | Jumlah |
| --- | --- | --- |
| Reward bermain / turnamen | 40% | 400.000.000 |
| Likuiditas | 20% | 200.000.000 |
| Tim (vesting — lihat peringatan) | 15% | 150.000.000 |
| Komunitas / airdrop pemain aktif lama | 15% | 150.000.000 |
| Treasury | 10% | 100.000.000 |

### FlapArena — `contracts/FlapArena.sol`

Vault turnamen + klaim reward + staking Pilot sederhana:

- `recordVerifiedScore` — hanya `verifier` terpercaya (diset owner),
  satu `replayHash` hanya bisa dipakai sekali, reward diakru
  1 FLAP per 100 poin (`REWARD_PER_100_POINTS`).
- `claimReward(pilotId)` — pemilik (atau delegatee) mengklaim, dibagi
  sesuai delegasi Pilot.
- `stakePilot` / `unstakePilot` — kustodi NFT pindah ke arena saat staking.
- `distributePrize` — owner membagi hadiah turnamen dari saldo arena.
- `fundRewards` — owner mengisi pool reward dengan $FLAP.

## Struktur

```
contracts/
  FlapPilot.sol   # ERC721 Pilot, mint, trait, reputasi, delegasi
  FlapToken.sol   # ERC20 $FLAP, fixed supply + distribusi
  FlapArena.sol   # vault, klaim reward terverifikasi, staking
  README.md       # cara compile/deploy ke BSC Testnet + peringatan
lib/
  bnb.ts          # chain 56/97, alamat dari env, ABI minimal (mintAgent saja)
  agentId.ts      # validasi format .ai + payload permit (BUKAN bukti klaim)
  agentIdVerify.ts # verifikasi klaim fail-closed + challenge kepemilikan wallet
  replay.ts       # tipe Replay, hashReplay (SHA-256), verifyReplay v1
app/
  api/agent/replay/route.ts  # POST replay terverifikasi (jalur resmi)
  api/agent/route.ts         # endpoint lama, dipertahankan, bukan jalur reward
  mint/page.tsx              # mint FlapPilot + klaim $FLAP (wagmi)
  page.tsx                   # landing: BNB Chain, $FLAP, AI Arena
components/
  game/GameEngine.tsx        # engine canvas — DIPERTAHANKAN, jangan tulis ulang
  HomeScreen.tsx             # teks utama diperbarui ke BNB Chain / $FLAP
config/reownConfig.ts        # wallet: bsc + bscTestnet (bukan Base)
```

## Jalankan lokal

```bash
cp .env.example .env.local
# isi NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# NEXT_PUBLIC_REOWN_PROJECT_ID. Biarkan alamat FLAP_* kosong
# sampai ada deployment nyata.
npm install
npm run dev
```

Catatan: repo ini tidak menyertakan `node_modules` dan tidak ada
kredensial di `.env.example` — semua nilainya placeholder.

## Roadmap

- [x] Overhaul cabang `bnb-ai-overhaul`: kontrak, replay v1, endpoint replay, halaman mint, pindah ke BNB Chain
- [x] Gate mint Agent ID: `mintAgent` + permit server (`/api/mint/permit`) + halaman mint 3 langkah — wallet tanpa `.ai` ditolak kontrak
- [x] Celah `mint()` lama ditutup (selalu revert "FlapPilot: use mintAgent"); bukti kepemilikan wallet lewat signature challenge; modul verifikasi klaim fail-closed (`lib/agentIdVerify.ts`)
- [ ] Resolver klaim Binance/SpaceID produksi (`AGENT_ID_RESOLVER_URL` dengan service account yang sah ATAU alamat registry terverifikasi) — memblokir mainnet; tanpa resolver, permit ditolak dan testnet hanya untuk allowlist
- [ ] Samakan fisika replay penuh dengan `GameEngine.tsx` (koin, item, speed tier turnamen, urutan PRNG persis)
- [ ] Migrasi DB: kolom `replay_hash` + indeks unik untuk dedup replay di `game_sessions`
- [ ] Deploy ke BSC Testnet (97), uji mint → replay → klaim end-to-end dengan testnet BNB
- [ ] Audit kontrak, lalu deploy mainnet (56) hanya dengan persetujuan pemilik
- [ ] Migrasi endpoint lama (`submit_score`, shop USDC Base, AgentDocs, admin) atau tandai deprecated resmi
- [ ] Vesting tim on-chain untuk alokasi 15% (saat ini hanya alamat tujuan di constructor)

## Belum selesai (jujur)

- **Resolver klaim Binance/SpaceID produksi belum ada:**
  `/api/mint/permit` sekarang (a) mewajibkan signature challenge yang
  membuktikan kepemilikan wallet, dan (b) memanggil
  `verifyAgentIdClaim()` yang gagal-tertutup: tanpa
  `AGENT_ID_RESOLVER_URL` yang dikonfigurasi deployer, permit DITOLAK
  (503 "resolver not configured"), dan testnet-allowlist ditolak
  mentah untuk mainnet (56). Yang belum ada adalah resolver produksi
  itu sendiri — endpoint domain-resolve Binance butuh sesi login dan
  sesi pribadi user tidak boleh dipakai sebagai kredensial backend,
  dan tidak ada alamat registry SpaceID terverifikasi yang ditemukan
  untuk dikarang ke kode. Jadi: format handle saja BUKAN bukti, dan
  signature challenge saja BUKAN bukti klaim `.ai`. JANGAN aktifkan
  permit mainnet sebelum resolver yang sah itu ada. Sampai saat itu,
  permit hanya untuk BSC Testnet dengan pasangan allowlist.
- **Verifikasi fisika penuh:** `lib/replay.ts` v1 hanya mensimulasikan pipa.
  Koin, item/power-up, multiplier, speed tier turnamen, dan urutan random
  persis `GameEngine` belum disamakan. Replay v1 dengan `coinsCollected > 0`
  ditolak. Jangan bayar reward mainnet sebelum ini selesai.
- **Deploy:** tidak ada kontrak yang di-deploy di branch ini (mainnet maupun testnet).
- **Audit:** tidak ada audit.
- **Dedup replay di DB:** `FlapArena` menolak `replayHash` ganda on-chain,
  tapi tabel skor belum punya kolom `replay_hash` unik.
- **Sisa referensi lama:** endpoint lama `app/api/agent/route.ts`, shop
  (`app/api/shop/purchase/route.ts`, Base/USDC), `components/AgentDocs.tsx`,
  dan halaman admin masih menyebut Base/USDC. Mereka sengaja tidak
  dirombak di branch ini agar jalur lama tidak rusak; migrasi/deprecate
  mereka adalah tugas berikutnya (lihat Roadmap).
- **Verifier tunggal:** `FlapArena` mempercayai satu alamat verifier.
  Kompromi kunci itu = reward palsu. Gunakan multisig / threshold sebelum produksi.
- **Vesting tim:** tidak ada jadwal vesting on-chain di `FlapToken` v1.
