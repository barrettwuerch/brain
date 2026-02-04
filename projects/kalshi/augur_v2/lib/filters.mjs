export function compileRules(rules = []) {
  return rules.map(r => {
    let re = null;
    if (r.titleRegex) {
      let pat = String(r.titleRegex);
      let flags = '';
      // Allow PCRE-style inline (?i) for convenience.
      if (pat.startsWith('(?i)')) {
        pat = pat.slice(4);
        flags = 'i';
      }
      re = new RegExp(pat, flags);
    }
    return {
      name: r.name,
      seriesTickerPrefix: r.seriesTickerPrefix || null,
      tickerPrefix: r.tickerPrefix || null,
      titleRe: re,
    };
  });
}

export function matchAny(mkt, compiledRules) {
  const title = String(mkt?.title || '');
  const series = String(mkt?.series_ticker || mkt?.seriesTicker || mkt?.__series_ticker || '');
  const ticker = String(mkt?.ticker || '');

  for (const r of compiledRules) {
    if (r.seriesTickerPrefix && series.startsWith(r.seriesTickerPrefix)) return { ok: true, rule: r.name, why: 'series_prefix' };
    if (r.tickerPrefix && ticker.startsWith(r.tickerPrefix)) return { ok: true, rule: r.name, why: 'ticker_prefix' };
    if (r.titleRe && r.titleRe.test(title)) return { ok: true, rule: r.name, why: 'title_regex' };
  }
  return { ok: false };
}
