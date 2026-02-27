import 'dotenv/config';
import { routeUnroutedFindings } from '../bots/orchestrator/routing';

async function main() {
  console.log('Routing unrouted findings...');
  const routed = await routeUnroutedFindings();
  console.log(`Routed ${routed} findings to formalize+challenge pipeline`);
}

main().catch(e => { console.error(e); process.exit(1); });
