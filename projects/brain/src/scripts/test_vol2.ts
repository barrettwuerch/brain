import 'dotenv/config';
import { getCryptoOHLCV } from '../adapters/alpaca/data_feed';

async function main() {
  const bars = await getCryptoOHLCV('BTC/USD', '1d', 31);
  console.log(`Got ${bars.length} bars`);
  const avgVol = bars.slice(0, 30).reduce((s, b) => s + b.volume, 0) / 30;
  console.log(`Avg vol: ${avgVol.toFixed(4)}`);
  let above = 0;
  for (const b of bars.slice(1)) {
    const ratio = b.volume / avgVol;
    const fired = ratio > 1.5;
    if (fired) above++;
    console.log(`${b.timestamp.slice(0,10)} ratio=${ratio.toFixed(3)} ${fired ? '✅ WOULD FIRE' : ''}`);
  }
  console.log(`\nWould have fired ${above}/${bars.length-1} days`);
}
main().catch(console.error);
