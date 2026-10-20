// Holders of any SPL mint, grouped by owner wallet. Needs HELIUS_API_KEY (Vercel env).
const SYS = '11111111111111111111111111111111';
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
async function rpc(url, method, params) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  if (!r.ok) throw new Error(method + ' HTTP ' + r.status);
  const j = await r.json(); if (j.error) throw new Error(method + ': ' + (j.error.message || 'error'));
  return j.result;
}
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const mint = String((req.query && req.query.mint) || '').trim();
  const key = process.env.HELIUS_API_KEY;
  if (!B58.test(mint)) return res.status(400).json({ error: 'not a Solana address' });
  if (!key) { // no key: Jupiter's public holder list (top 100 wallets, pools tagged) + exact holder count
    try {
      const [hj, tj] = await Promise.all([
        fetch('https://datapi.jup.ag/v1/holders/' + mint).then((r) => r.json()),
        fetch('https://lite-api.jup.ag/tokens/v2/search?query=' + mint).then((r) => r.json()),
      ]);
      const t = (tj || []).find((x) => x.id === mint) || {};
      const sup = Number(t.totalSupply || t.circSupply || 0) || 1e9; // brand-new coins aren't indexed yet; pump.fun supply is 1B
      const all = (hj.holders || []).map((h) => ({ owner: h.address, amount: Number(h.amount) || 0, pool: (h.tags || []).some((x) => x.id === 'Pool') }));
      const pools = all.filter((h) => h.pool).map((h) => ({ owner: h.owner, pct: +((h.amount / sup) * 100).toFixed(3) }));
      const holders = all.filter((h) => !h.pool).map((h) => ({ o: h.owner, a: +h.amount.toFixed(2), p: +((h.amount / sup) * 100).toFixed(5) }));
      res.setHeader('Cache-Control', holders.length ? 's-maxage=30, stale-while-revalidate=300' : 's-maxage=10');
      return res.status(200).json({ at: Date.now(), mint, name: t.name || '', symbol: t.symbol || '', image: t.icon || null, decimals: t.decimals ?? 6, supply: sup, wallets: hj.count || t.holderCount || holders.length, pools, holders, source: 'jupiter' });
    } catch (e) { res.setHeader('Cache-Control', 'no-store'); return res.status(502).json({ error: String(e.message || e) }); }
  }
  const url = 'https://mainnet.helius-rpc.com/?api-key=' + key;
  try {
    const asset = await rpc(url, 'getAsset', { id: mint }).catch(() => null);
    const ti = (asset && asset.token_info) || {};
    const decimals = ti.decimals ?? 6;
    const supply = Number(ti.supply || 0) / 10 ** decimals;
    const meta = (asset && asset.content && asset.content.metadata) || {};
    const image = (asset && asset.content && ((asset.content.links || {}).image || ((asset.content.files || [])[0] || {}).uri)) || null;
    const byOwner = new Map(); let total = 0;
    for (let page = 1; page <= 5; page++) {
      const r = await rpc(url, 'getTokenAccounts', { mint, page, limit: 1000, options: { showZeroBalance: false } });
      const arr = (r && r.token_accounts) || [];
      for (const a of arr) { const v = Number(a.amount) / 10 ** decimals; if (v > 0) byOwner.set(a.owner, (byOwner.get(a.owner) || 0) + v); }
      total = Math.max(total, r && r.total || 0);
      if (arr.length < 1000) break;
    }
    let holders = [...byOwner.entries()].map(([owner, amount]) => ({ owner, amount })).sort((a, b) => b.amount - a.amount);
    const sup = supply || holders.reduce((s, h) => s + h.amount, 0) || 1;
    holders.forEach((h) => { h.pct = (h.amount / sup) * 100; });
    // owners that are programs (bonding curve, AMM pools, lockers) are pools, not creatures
    const top = holders.slice(0, 40).map((h) => h.owner);
    const info = await rpc(url, 'getMultipleAccounts', [top, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }]).catch(() => null);
    const pools = new Set();
    if (info && info.value) info.value.forEach((v, i) => { if (!v || (v.owner && v.owner !== SYS)) pools.add(top[i]); });
    const poolList = holders.filter((h) => pools.has(h.owner)).map((h) => ({ owner: h.owner, pct: +h.pct.toFixed(3) }));
    holders = holders.filter((h) => !pools.has(h.owner)).slice(0, 2000).map((h) => ({ o: h.owner, a: +h.amount.toFixed(2), p: +h.pct.toFixed(5) }));
    res.setHeader('Cache-Control', holders.length ? 's-maxage=30, stale-while-revalidate=300' : 's-maxage=10');
    res.status(200).json({ at: Date.now(), mint, name: meta.name || '', symbol: meta.symbol || '', image, decimals, supply: sup, wallets: byOwner.size, accounts: total, pools: poolList, holders });
  } catch (e) { res.setHeader('Cache-Control', 'no-store'); res.status(502).json({ error: String(e.message || e) }); }
};
