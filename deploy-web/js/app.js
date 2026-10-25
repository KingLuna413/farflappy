// FarFlappy AI Arena — browser-only deployer.
// NO backend, NO server key, NO private-key storage. All signing happens
// in the user's own Rabby extension wallet via ethers v6.
// Rabby is found via EIP-6963 (rdns io.rabby), window.ethereum.providers,
// or window.ethereum.isRabby — in that order. If Rabby is not found,
// no other wallet is silently used: deploy buttons stay off and the
// user is told to install/enable the Rabby extension.
// If ethers or a Rabby provider is missing, every deploy button stays off
// and a clear message is shown — nothing is ever sent anywhere else.

const AGENT_WALLET = '0x9707C99D8247fBBB5E806a389160372602578009'; // luna404.ai, public address only
const NETWORKS = {
  97: { name: 'BSC Testnet', rpc: 'https://data-seed-prebsc-1-s1.binance.org:8545', explorer: 'https://testnet.bscscan.com', symbol: 'tBNB' },
  56: { name: 'BSC Mainnet', rpc: 'https://bsc-dataseed.binance.org', explorer: 'https://bscscan.com', symbol: 'BNB' },
};
const state = { provider: null, injected: null, signer: null, address: null, chainId: null, pilot: null, token: null, arena: null, verifier: AGENT_WALLET };
const eip6963Providers = new Map(); // rdns -> provider, from eip6963:announceProvider
if (typeof window !== 'undefined') {
  window.addEventListener('eip6963:announceProvider', (ev) => {
    try { if (ev.detail?.info?.rdns && ev.detail?.provider) eip6963Providers.set(ev.detail.info.rdns, ev.detail.provider); } catch {}
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}
function getRabbyProvider() {
  // 1) EIP-6963 announcement from Rabby (rdns io.rabby)
  if (eip6963Providers.get('io.rabby')) return eip6963Providers.get('io.rabby');
  const eth = window.ethereum;
  if (!eth) return null;
  // 2) Multiple injected providers (e.g. MetaMask + Rabby)
  if (Array.isArray(eth.providers)) {
    const rabby = eth.providers.find((pr) => pr && pr.isRabby);
    if (rabby) return rabby;
  }
  // 3) Single injected provider that is Rabby
  if (eth.isRabby) return eth;
  return null;
}
function rabbyMissingMessage() {
  return 'Rabby tidak terdeteksi. Pasang dan aktifkan ekstensi Rabby (rabby.io) di browser desktop, lalu refresh halaman ini. Wallet lain tidak dipakai sebagai pengganti Rabby di halaman ini.';
}

const $ = (id) => document.getElementById(id);
function log(msg, cls) {
  const el = $('log'); const d = document.createElement('div');
  if (cls) d.className = cls; d.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`; el.appendChild(d); el.scrollTop = el.scrollHeight;
}
function setStatus(id, html) { $(id).innerHTML = html; }
function explorer() { return NETWORKS[state.chainId]?.explorer || 'https://testnet.bscscan.com'; }
function txLink(hash) { return `${explorer()}/tx/${hash}`; }
function addrLink(a) { return `${explorer()}/address/${a}`; }
function isAddr(v) { try { return window.ethers && window.ethers.isAddress(v); } catch { return false; } }
function mainnetGateOk() {
  if (state.chainId !== 56) return true;
  return $('mainnet-confirm-text').value === 'DEPLOY MAINNET'
    && $('chk-audit').checked && $('chk-dist').checked && $('chk-resolver').checked;
}
function setMainnetGate() {
  // Display only; the actual disabling is done in refreshDeployButtons()
  // so the sequential step gating and the mainnet gate AND together.
  $('mainnet-gate').style.display = state.chainId === 56 ? 'block' : 'none';
}
function refreshDeployButtons() {
  // Sequential gating: a step is usable only when its prerequisites exist.
  $('btn-pilot').disabled = !(state.signer && state.pilot === null);
  $('btn-token').disabled = !(state.signer && state.token === null);
  $('btn-arena').disabled = !(state.signer && state.pilot && state.token && state.arena === null);
  $('btn-setup').disabled = !(state.signer && state.pilot && state.arena);
  $('btn-fund').disabled = !(state.signer && state.token && state.arena);
  setMainnetGate();
  if (!mainnetGateOk() || !window.ethers || !getRabbyProvider()) {
    document.querySelectorAll('.deploy-btn').forEach(b => { b.disabled = true; });
  }
}
function requireWallet() {
  if (!getRabbyProvider()) { log(rabbyMissingMessage(), 'fail'); return false; }
  if (!window.ethers) { log('Library ethers dari CDN gagal dimuat. Periksa koneksi, lalu refresh halaman.', 'fail'); return false; }
  if (!state.signer) { log('Connect wallet dulu (Langkah 1).', 'fail'); return false; }
  return true;
}

async function connectWallet() {
  let injected = getRabbyProvider();
  if (!injected) {
    // Rabby may not have announced yet: ask again and wait briefly, then retry once.
    try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch {}
    await new Promise((r) => setTimeout(r, 300));
    injected = getRabbyProvider();
  }
  if (!injected) { setStatus('wallet-status', '<span class="fail">' + rabbyMissingMessage() + '</span>'); return; }
  if (!window.ethers) { setStatus('wallet-status', '<span class="fail">Ethers CDN gagal dimuat. Periksa koneksi lalu refresh.</span>'); return; }
  try {
    await injected.request({ method: 'eth_requestAccounts' });
    state.injected = injected;
    state.provider = new window.ethers.BrowserProvider(injected);
    state.signer = await state.provider.getSigner();
    state.address = await state.signer.getAddress();
    const net = await state.provider.getNetwork();
    const newChainId = Number(net.chainId);
    if (state.chainId !== null && state.chainId !== newChainId) {
      // Switching chains mid-flow must not mix testnet and mainnet addresses.
      state.pilot = state.token = state.arena = null;
      log('Chain berubah — alamat deploy sesi sebelumnya dihapus, mulai lagi dari Langkah 2 di chain baru.');
    }
    state.chainId = newChainId;
    const bal = await state.provider.getBalance(state.address);
    const sym = NETWORKS[state.chainId]?.symbol || 'native';
    setStatus('wallet-status', `Terhubung: <code>${state.address}</code><br>Chain: ${state.chainId} (${NETWORKS[state.chainId]?.name || 'tidak dikenal'})<br>Saldo: ${window.ethers.formatEther(bal)} ${sym}`);
    log(`Connected ${state.address} on chain ${state.chainId}`);
    // Pre-fill distribution + verifier defaults with the deployer's address.
    for (const id of ['tok-liquidity', 'tok-team', 'tok-community', 'tok-treasury']) if (!$(id).value) $(id).value = state.address;
    if (!$('arena-verifier').value) $('arena-verifier').value = AGENT_WALLET;
    refreshDeployButtons();
  } catch (e) { log(`Connect gagal: ${e.message || e}`, 'fail'); }
}

async function switchNetwork(chainId) {
  const injected = getRabbyProvider();
  if (!injected) { log(rabbyMissingMessage(), 'fail'); return; }
  const hex = '0x' + chainId.toString(16);
  try {
    await injected.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
  } catch (e) {
    if (e.code === 4902) {
      const n = NETWORKS[chainId];
      await injected.request({ method: 'wallet_addEthereumChain', params: [{ chainId: hex, chainName: n.name, rpcUrls: [n.rpc], nativeCurrency: { name: n.symbol, symbol: n.symbol, decimals: 18 }, blockExplorerUrls: [n.explorer] }] });
    } else throw e;
  }
  // Re-read chain after switch.
  await connectWallet();
}

async function deployContract(name, args, label) {
  const data = window.FLAP_CONTRACTS[name];
  if (!data) throw new Error(`Data kontrak ${name} tidak ditemukan di js/contracts-data.js`);
  log(`Deploy ${name}… JANGAN refresh halaman selama transaksi berjalan.`);
  const factory = new window.ethers.ContractFactory(data.abi, data.bytecode, state.signer);
  const contract = await factory.deploy(...args);
  log(`${name}: transaksi deploy dikirim: ${contract.deploymentTransaction().hash} — ${txLink(contract.deploymentTransaction().hash)}`);
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  log(`${name} ter-deploy di ${addr} — ${addrLink(addr)}`, 'done');
  return { contract, addr };
}

async function stepPilot() {
  if (!requireWallet()) return; refreshDeployButtons();
  try { const r = await deployContract('FlapPilot', [], 'FlapPilot'); state.pilot = r.addr; $('arena-pilot').value = r.addr; setStatus('pilot-status', `<span class="done">FlapPilot: <a href="${addrLink(r.addr)}" target="_blank" rel="noopener">${r.addr}</a></span>`); } catch (e) { log(`Deploy FlapPilot gagal: ${e.message || e}`, 'fail'); }
  refreshDeployButtons(); renderOutput();
}
async function stepToken() {
  if (!requireWallet()) return;
  const [liq, team, comm, treas] = ['tok-liquidity', 'tok-team', 'tok-community', 'tok-treasury'].map(id => $(id).value.trim());
  if (![liq, team, comm, treas].every(isAddr)) { log('Alamat distribusi $FLAP tidak valid. Isi keempatnya dengan alamat EOA yang benar.', 'fail'); return; }
  try {
    const r = await deployContract('FlapToken', [state.address, liq, team, comm, treas], 'FlapToken');
    state.token = r.addr; $('arena-token').value = r.addr;
    setStatus('token-status', `<span class="done">FlapToken ($FLAP): <a href="${addrLink(r.addr)}" target="_blank" rel="noopener">${r.addr}</a><br>rewardPool interim = deployer (${state.address}) — arena belum ada saat token di-deploy, jadi 40% reward akan ditransfer di Langkah 6.</span>`);
  } catch (e) { log(`Deploy FlapToken gagal: ${e.message || e}`, 'fail'); }
  refreshDeployButtons(); renderOutput();
}
async function stepArena() {
  if (!requireWallet()) return;
  const token = $('arena-token').value.trim(), pilot = $('arena-pilot').value.trim(), verifier = $('arena-verifier').value.trim();
  if (![token, pilot, verifier].every(isAddr)) { log('Alamat token / pilot / verifier tidak valid.', 'fail'); return; }
  state.verifier = verifier;
  try { const r = await deployContract('FlapArena', [token, pilot, verifier], 'FlapArena'); state.arena = r.addr; setStatus('arena-status', `<span class="done">FlapArena: <a href="${addrLink(r.addr)}" target="_blank" rel="noopener">${r.addr}</a></span>`); } catch (e) { log(`Deploy FlapArena gagal: ${e.message || e}`, 'fail'); }
  refreshDeployButtons(); renderOutput();
}
async function stepSetup() {
  if (!requireWallet()) return;
  try {
    const pilot = new window.ethers.Contract(state.pilot, window.FLAP_CONTRACTS.FlapPilot.abi, state.signer);
    log('Mengirim FlapPilot.setArena… jangan refresh.');
    let tx = await pilot.setArena(state.arena); log(`setArena tx: ${tx.hash} — ${txLink(tx.hash)}`); await tx.wait(); log('setArena terkonfirmasi.', 'done');
    log('Mengirim FlapPilot.setVerifier… jangan refresh.');
    tx = await pilot.setVerifier(state.verifier); log(`setVerifier tx: ${tx.hash} — ${txLink(tx.hash)}`); await tx.wait(); log('setVerifier terkonfirmasi.', 'done');
    setStatus('setup-status', '<span class="done">Setup selesai: arena dan verifier sudah diset di FlapPilot.</span>');
  } catch (e) { log(`Setup gagal: ${e.message || e}`, 'fail'); }
  renderOutput();
}
async function stepFund() {
  if (!requireWallet()) return;
  try {
    const token = new window.ethers.Contract(state.token, window.FLAP_CONTRACTS.FlapToken.abi, state.signer);
    const amount = window.ethers.parseUnits('400000000', 18); // 40% of 1,000,000,000
    log('Mengirim transfer 400.000.000 $FLAP ke arena… jangan refresh.');
    const tx = await token.transfer(state.arena, amount); log(`transfer tx: ${tx.hash} — ${txLink(tx.hash)}`); await tx.wait();
    const bal = await token.balanceOf(state.arena);
    log(`Saldo arena on-chain: ${window.ethers.formatUnits(bal, 18)} $FLAP`, 'done');
    setStatus('fund-status', `<span class="done">Saldo arena terverifikasi on-chain: ${window.ethers.formatUnits(bal, 18)} $FLAP.</span>`);
  } catch (e) { log(`Transfer reward gagal: ${e.message || e}`, 'fail'); }
  renderOutput();
}
function renderOutput() {
  const chain = state.chainId || 97;
  const env = `NEXT_PUBLIC_FLAP_PILOT_ADDRESS=${state.pilot || ''}\nNEXT_PUBLIC_FLAP_TOKEN_ADDRESS=${state.token || ''}\nNEXT_PUBLIC_FLAP_ARENA_ADDRESS=${state.arena || ''}\nNEXT_PUBLIC_CHAIN_ID=${chain}`;
  $('env-output').textContent = env;
  $('deploy-summary').innerHTML = state.pilot || state.token || state.arena
    ? `FlapPilot: ${state.pilot ? `<a href="${addrLink(state.pilot)}" target="_blank" rel="noopener">${state.pilot}</a>` : '—'}<br>FlapToken: ${state.token ? `<a href="${addrLink(state.token)}" target="_blank" rel="noopener">${state.token}</a>` : '—'}<br>FlapArena: ${state.arena ? `<a href="${addrLink(state.arena)}" target="_blank" rel="noopener">${state.arena}</a>` : '—'}<br>Verifier: <code>${state.verifier}</code>`
    : 'Belum ada kontrak yang ter-deploy dari sesi ini.';
  $('bscan-verify').textContent = state.pilot && state.token && state.arena
    ? `Verifikasi di BscScan (pilih network yang sama):\n- FlapPilot: ${addrLink(state.pilot)} (constructor: tanpa argumen)\n- FlapToken: ${addrLink(state.token)} (constructor: rewardPool=${state.address}, liquidity/team/community/treasury sesuai input Langkah 3)\n- FlapArena: ${addrLink(state.arena)} (constructor: token=${state.token}, pilot=${state.pilot}, verifier=${state.verifier})\nDi BscScan, buka tab Contract > Verify and Publish, pilih Solidity 0.8.24, optimizer + via-IR sesuai hardhat.config.ts di repo FarFlappy, dan tempel source .sol yang sama persis dengan yang di-compile.`
    : 'Alamat verifikasi BscScan akan muncul setelah ketiga kontrak ter-deploy.';
}
function copyAll() {
  const text = $('env-output').textContent + '\n\n' + $('deploy-summary').innerText;
  navigator.clipboard.writeText(text).then(() => log('Output disalin.', 'done'), () => log('Gagal menyalin otomatis — salin manual dari kotak output.', 'fail'));
}

document.addEventListener('DOMContentLoaded', () => {
  if (!getRabbyProvider()) $('wallet-status').innerHTML = '<span class="fail">' + rabbyMissingMessage() + '</span>';
  else $('wallet-status').innerHTML = '<span class="done">Rabby terdeteksi. Klik Connect Rabby untuk menghubungkan.</span>';
  if (!window.ethers) log('PERINGATAN: ethers dari CDN tidak termuat. Semua tombol deploy dinonaktifkan sampai CDN berhasil dimuat dan halaman di-refresh.', 'fail');
  if (!window.FLAP_CONTRACTS) log('PERINGATAN: js/contracts-data.js tidak termuat. Deploy tidak bisa jalan — pastikan file itu ada di folder js/.', 'fail');
  $('btn-connect').addEventListener('click', connectWallet);
  $('btn-testnet').addEventListener('click', () => switchNetwork(97).catch(e => log(`Switch network gagal: ${e.message || e}`, 'fail')));
  $('btn-mainnet').addEventListener('click', () => switchNetwork(56).catch(e => log(`Switch network gagal: ${e.message || e}`, 'fail')));
  $('btn-fill-deployer').addEventListener('click', () => { if (!state.address) { log('Connect wallet dulu.', 'fail'); return; } for (const id of ['tok-liquidity', 'tok-team', 'tok-community', 'tok-treasury']) $(id).value = state.address; });
  $('btn-pilot').addEventListener('click', stepPilot);
  $('btn-token').addEventListener('click', stepToken);
  $('btn-arena').addEventListener('click', stepArena);
  $('btn-setup').addEventListener('click', stepSetup);
  $('btn-fund').addEventListener('click', stepFund);
  $('btn-copy').addEventListener('click', copyAll);
  ['mainnet-confirm-text', 'chk-audit', 'chk-dist', 'chk-resolver'].forEach(id => $(id).addEventListener('input', refreshDeployButtons));
  ['mainnet-confirm-text', 'chk-audit', 'chk-dist', 'chk-resolver'].forEach(id => $(id).addEventListener('change', refreshDeployButtons));
  const rabby0 = getRabbyProvider();
  if (rabby0) { rabby0.on?.('chainChanged', () => connectWallet()); rabby0.on?.('accountsChanged', () => connectWallet()); }
  // Rabby may announce itself after load: re-check once announcements arrive.
  window.addEventListener('eip6963:announceProvider', () => { const r = getRabbyProvider(); if (r && !$('wallet-status').textContent.includes('Rabby terdeteksi')) $('wallet-status').innerHTML = '<span class="done">Rabby terdeteksi. Klik Connect Rabby untuk menghubungkan.</span>'; });
  refreshDeployButtons(); renderOutput();
});
