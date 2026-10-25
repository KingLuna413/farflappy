# FarFlappy AI Arena — Browser Deployer

Deploy FlapPilot, $FLAP (FlapToken), dan FlapArena langsung dari browser HP,
tanpa server dan tanpa private key yang dikirim ke siapa pun.

## Cara pakai dari HP (MetaMask mobile)

1. Di MetaMask mobile, buka in-app browser dan buka halaman ini
   (di-host statis, atau file `index.html` lokal — lihat "Cara host" di bawah).
2. Pastikan wallet berisi native token untuk gas di chain yang dipilih:
   tBNB untuk BSC Testnet (97), BNB untuk BSC Mainnet (56).
3. Langkah 1: Connect wallet, lalu switch network ke 97 (testnet dulu).
4. Langkah 2–6, satu tombol per langkah, tunggu tiap transaksi terkonfirmasi.
   **Jangan refresh selama transaksi berjalan.**
5. Langkah 7: salin ketiga alamat kontrak dan snippet env Next.js.
6. Langkah 8 (opsional, manual): transfer ownership FlapPilot dan FlapArena
   ke wallet agent, lewat BscScan Write Contract — halaman ini tidak
   melakukannya otomatis.

## Yang TIDAK dilakukan web ini

- Tidak ada backend, tidak ada server key, tidak menyimpan private key.
- Tidak memverifikasi keamanan kontrak — itu tugas audit dan testnet.
- Tidak bisa connect wallet agent Binance (luna404.ai, MPC) seperti MetaMask.
  Web ini memakai EOA biasa (MetaMask / Binance Web3 Wallet di browser HP).
  Wallet agent dipakai setelahnya sebagai verifier/owner lewat alamat
  publiknya: `0x9707C99D8247fBBB5E806a389160372602578009`.
- Tidak meng-upgrade kontrak: kontrak tidak upgradeable, deploy mainnet
  tidak bisa dibatalkan.

## Cara host statis

Web ini sengaja tanpa build step: hanya `index.html`, `css/style.css`,
`js/app.js`, dan `js/contracts-data.js` (plus CDN ethers v6).

- GitHub Pages: push folder ini ke repo baru, aktifkan Pages dari branch
  tersebut. Catatan: file `js/contracts-data.js` berisi bytecode publik —
  itu memang sengaja dipublikasikan, sama seperti bytecode kontrak yang
  sudah ter-deploy dan bisa dibaca siapa pun di BscScan.
- Vercel / Netlify: deploy folder ini sebagai static site.
- Lokal: buka `index.html` langsung — tapi wallet injected (MetaMask)
  biasanya hanya tersedia di in-app browser / extension browser, jadi
  untuk deploy sungguhan pakai in-app browser MetaMask, bukan viewer file
  biasa tanpa wallet.

Jika CDN ethers gagal dimuat, halaman menampilkan peringatan jelas dan
semua tombol deploy nonaktif. Periksa koneksi, lalu refresh.

## Cara verifikasi kontrak di BscScan

1. Buka link alamat kontrak dari Langkah 7, di explorer network yang sama
   (testnet.bscscan.com untuk 97, bscscan.com untuk 56).
2. Tab Contract → Verify and Publish.
3. Compiler: Solidity 0.8.24, optimizer + via-IR, sesuai
   `hardhat.config.ts` di repo FarFlappy (`contracts/`).
4. Tempel source `.sol` yang sama persis dengan yang di-compile Hardhat.
5. Constructor arguments:
   - FlapPilot: tanpa argumen.
   - FlapToken: rewardPool (deployer, interim), liquidity, team,
     community, treasury — sesuai input Langkah 3.
   - FlapArena: token, pilot, verifier — sesuai input Langkah 4.

## Cara sinkronisasi bytecode jika kontrak berubah

Jangan pernah menulis bytecode dengan tangan.

1. Di repo FarFlappy, ubah `.sol`, lalu `npx hardhat compile` di
   `contracts/` (sumber: `contracts/src/*.sol`).
2. Di repo web ini, jalankan:
   ```
   node scripts/extract-artifacts.mjs --verify
   ```
   Script ini membaca artifact JSON Hardhat (`artifacts/src/*.sol/*.json`)
   dan menulis ulang `js/contracts-data.js` (ABI + creation bytecode).
   Dengan `--verify`, script membandingkan bytecode hasil extract dengan
   artifact byte-per-byte (sha256 + panjang + prefix) dan gagal kalau
   tidak identik.
3. Commit `js/contracts-data.js` yang baru, lalu deploy ulang dari web
   (kontrak lama tidak berubah — deploy baru menghasilkan alamat baru).

## Pengaman mainnet di web ini

Jika chain = 56 (BSC Mainnet), semua tombol deploy nonaktif sampai user
mengetik persis `DEPLOY MAINNET` dan mencentang tiga pernyataan:
kontrak belum tentu diaudit / deploy tidak bisa dibatalkan, distribusi
$FLAP sudah final (multisig/vesting), dan resolver produksi klaim `.ai`
sudah ada. Ini pengaman UI, bukan pengganti audit.

## Urutan deploy (ringkas)

FlapPilot → FlapToken (rewardPool interim = deployer) → FlapArena
(token, pilot, verifier) → FlapPilot.setArena → FlapPilot.setVerifier →
transfer 400.000.000 $FLAP (40%) ke arena → baca saldo arena on-chain.

## Yang masih perlu dicek sebelum web ini dipakai

- [ ] Test connect di browser HP sungguhan (MetaMask mobile in-app browser
      dan Binance Web3 Wallet), bukan hanya desktop.
- [ ] Test deploy sungguhan di BSC Testnet (97) end-to-end, termasuk
      switch/add network, setArena, setVerifier, transfer reward, dan
      verifikasi saldo arena.
- [ ] Test pengaman mainnet: tombol deploy nonaktif di chain 56 sampai
      konfirmasi diketik dan dicentang.
- [ ] Test verifikasi BscScan dengan source dan constructor args di atas.
- [ ] Test fallback CDN ethers gagal (offline / CDN diblokir): tombol
      deploy harus nonaktif dengan pesan jelas.
- [ ] Re-extract bytecode setiap kali kontrak FarFlappy berubah, sebelum
      web ini dipakai untuk deploy berikutnya.
