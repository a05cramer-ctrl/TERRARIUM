// Top pump.fun coins by 1h volume (Jupiter), for the tank picker.
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const r = await fetch('https://lite-api.jup.ag/tokens/v2/toptraded/1h?limit=100');
    if (!r.ok) throw new Error('jupiter ' + r.status);
    const arr = await r.json();
    const out = arr.filter((t) => t.launchpad === 'pump.fun').map((t) => {
      const s = t.stats1h || {};
      return { mint: t.id, name: t.name, symbol: t.symbol, icon: t.icon || null, mcap: Math.round(t.mcap || 0), vol1h: Math.round((s.buyVolume || 0) + (s.sellVolume || 0)), holders: t.holderCount || 0 };
    }).sort((a, b) => b.vol1h - a.vol1h).slice(0, 12);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ at: Date.now(), coins: out });
  } catch (e) { res.setHeader('Cache-Control', 'no-store'); res.status(502).json({ error: String(e.message || e) }); }
};
