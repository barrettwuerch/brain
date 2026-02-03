/**
 * INTEGRATION_PATCH.mjs (reference only)
 *
 * This is not meant to be executed.
 * It shows the minimal integration steps to wire empirical_fv into weather_bot.
 */

/*
1) Import the model:

  import { computeEmpiricalFVs } from './empirical_fv.mjs';

2) Load base rates once at startup (optional, but recommended):

  const baseRates = {
    stats: fs.existsSync(cfg.fv.baseRatesPath) ? JSON.parse(fs.readFileSync(cfg.fv.baseRatesPath,'utf8')) : null,
    sortedValues: fs.existsSync(cfg.fv.sortedValuesPath) ? JSON.parse(fs.readFileSync(cfg.fv.sortedValuesPath,'utf8')) : null,
  };

3) In the per-city+event group loop, replace computeCoherentFVs(...) with:

  const month = extractMonthFromEventTicker(et); // "KXHIGHNY-26FEB04" -> 2
  const emp = computeEmpiricalFVs({
    brackets,
    cityCode: code,
    month,
    forecastHighF: fh.maxF,
    horizonHours: horizonH,
    baseRates,
  });

  const fvByMarket = emp.fvByTicker;

  log.write({ type:'fv_group', model: emp.model, ...emp.meta, city: code, event: et, brackets: brackets.length });
  log.write({ type:'fv_detail', model: emp.model, ...emp.meta, city: code, event: et, brackets: brackets.map(b => ({...b, ...fvByMarket.get(b.ticker)})) });

  // Fallback: if emp.model === 'uniform' or baseRates missing, you can fall back to Gaussian.
*/
