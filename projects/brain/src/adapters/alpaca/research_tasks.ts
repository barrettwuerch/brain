import 'dotenv/config';

import { supabaseAdmin } from '../../lib/supabase';
import { classifyFundingRate, classifyVolatilityRegime, computeRealizedVol, computeRollingCorrelation, detectVolumeAnomaly, scanMarketTrend } from './compute';
import { getBTCDominanceProxy, getCryptoOHLCV, getCryptoQuote, getFundingRate } from './data_feed';

async function insertTask(task_type: string, task_input: Record<string, any>) {
  const { error } = await supabaseAdmin.from('tasks').insert({
    task_type,
    task_input,
    status: 'queued',
    tags: ['research', 'crypto'],
    agent_role: 'research',
    desk: 'crypto_markets',
    bot_id: 'crypto-research-bot-1',
  });
  if (error) throw error;
}

function mean(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);
}

async function main() {
  const symbol = 'BTC/USD';

  // 1) crypto_trend_scan
  const bars10 = await getCryptoOHLCV(symbol, '4h', 10);
  const prices10 = bars10.map((b) => b.close);
  await insertTask('crypto_trend_scan', {
    market_type: 'crypto',
    symbol,
    timeframe: '4h',
    prices: prices10,
    expected_answer: scanMarketTrend(prices10),
    // minimal six-question narrative
    edge_type: 'microstructure',
    description: `Crypto trend scan on ${symbol} (4h, 10 bars).`,
    mechanism: 'Short-horizon price trends can persist due to momentum and liquidity gradients.',
    failure_conditions: 'News shocks or rapid regime flips invalidate simple trend signals.',
    sample_size: prices10.length,
    base_rate: 0.5,
    draft_recommendation: 'investigate_further',
    rqs_components: { statistical_rigor: 0.4, mechanism_clarity: 0.6, novelty: 0.4, cost_adjusted_edge: 0.4 },
  });

  // 2) crypto_volume_profile
  const bars30 = await getCryptoOHLCV(symbol, '1d', 30);
  const vols = bars30.map((b) => b.volume);
  const avgVol = mean(vols);
  const currentVol = vols[vols.length - 1];
  await insertTask('crypto_volume_profile', {
    market_type: 'crypto',
    symbol,
    currentVol,
    avgVol,
    expected_answer: detectVolumeAnomaly(currentVol, avgVol),
    edge_type: 'liquidity',
    description: `Volume anomaly check on ${symbol} (30d window).`,
    mechanism: 'Volume spikes can precede volatility expansions and directional breaks.',
    failure_conditions: 'Exchange-specific outages or data anomalies produce false spikes.',
    sample_size: vols.length,
    base_rate: 0.5,
    draft_recommendation: 'investigate_further',
    rqs_components: { statistical_rigor: 0.4, mechanism_clarity: 0.6, novelty: 0.3, cost_adjusted_edge: 0.4 },
  });

  // 3) funding_rate_scan
  const fr = await getFundingRate('BTCUSDT');
  await insertTask('funding_rate_scan', {
    market_type: 'crypto',
    symbol: 'BTC',
    rate: fr.rate,
    historical_avg: 0.0001,
    expected_answer: classifyFundingRate(fr.rate, 0.0001),
    edge_type: 'structural_flow',
    description: 'Funding rate scan for BTC perpetuals.',
    mechanism: 'Funding reflects positioning pressure; extremes can signal crowded trades.',
    failure_conditions: 'Funding can stay extreme during strong trends; timing is hard.',
    sample_size: 1,
    base_rate: 0.5,
    draft_recommendation: 'investigate_further',
    rqs_components: { statistical_rigor: 0.3, mechanism_clarity: 0.7, novelty: 0.3, cost_adjusted_edge: 0.4 },
  });

  // 4) volatility_regime_detect
  const closes30 = bars30.map((b) => b.close);
  const rv = computeRealizedVol(closes30);
  await insertTask('volatility_regime_detect', {
    market_type: 'crypto',
    symbol,
    realized_vol: rv,
    prices: closes30,
    expected_answer: classifyVolatilityRegime(rv),
    edge_type: 'behavioral',
    description: `Volatility regime detect on ${symbol}.`,
    mechanism: 'Risk premia and execution costs vary by volatility regime.',
    failure_conditions: 'Volatility clustering can break abruptly on catalysts.',
    sample_size: closes30.length,
    base_rate: 0.5,
    draft_recommendation: 'investigate_further',
    rqs_components: { statistical_rigor: 0.5, mechanism_clarity: 0.7, novelty: 0.3, cost_adjusted_edge: 0.5 },
  });

  // 5) correlation_scan
  const btc14 = (await getCryptoOHLCV('BTC/USD', '1d', 14)).map((b) => b.close);
  const eth14 = (await getCryptoOHLCV('ETH/USD', '1d', 14)).map((b) => b.close);
  const corr = computeRollingCorrelation(btc14, eth14);
  await insertTask('correlation_scan', {
    market_type: 'crypto',
    btc_prices: btc14,
    eth_prices: eth14,
    expected_answer: { correlation: corr, divergence: corr < 0.5 },
    edge_type: 'correlated_arbitrage',
    description: 'BTC/ETH correlation scan for regime divergence.',
    mechanism: 'Correlation breakdowns can indicate rotation or idiosyncratic drivers.',
    failure_conditions: 'Short samples produce noisy correlation estimates.',
    sample_size: btc14.length,
    base_rate: 0.5,
    draft_recommendation: 'investigate_further',
    rqs_components: { statistical_rigor: 0.4, mechanism_clarity: 0.6, novelty: 0.4, cost_adjusted_edge: 0.4 },
  });

  // Useful context for risk snapshot later
  const q = await getCryptoQuote(symbol);
  const spreadPct = (q.spread / Math.max((q.bid + q.ask) / 2, 1e-9));
  const btcDom = await getBTCDominanceProxy();
  console.log('Seeded 5 crypto research tasks.', { symbol, spreadPct, btcDom });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
