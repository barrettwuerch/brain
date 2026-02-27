import 'dotenv/config';
import { getCryptoOHLCV } from '../adapters/alpaca/data_feed';

async function main() {
  const bars = await getCryptoOHLCV('BTC/USD', '1d', 5);
  for (const b of bars) console.log(b.timestamp, 'vol=', b.volume, 'close=', b.close);
  if (bars.length >= 2) {
    const avgVol = bars.slice(0, bars.length-1).reduce((s, b) => s + b.volume, 0) / (bars.length-1);
    const cur = bars[bars.length-1].volume / Math.max(avgVol, 1);
    console.log('volume_ratio=', cur);
  }
}
main().catch(console.error);
