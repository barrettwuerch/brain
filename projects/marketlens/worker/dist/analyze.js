/**
 * analyze.ts (skeleton)
 *
 * Phase 1: select unprocessed stories, dedup/cluster, send clusters to LLM,
 * insert Insight rows, mark stories processed.
 */
async function main() {
    // TODO: query stories where is_processed=false
    // TODO: cluster by similarity (baseline: title similarity + source + time window)
    // TODO: call LLM with analyst prompt + JSON output
    // TODO: validate output against shared types / JSON schema
    // TODO: insert into `insights` with story_ids[]
    // TODO: mark those stories is_processed=true
    console.log('analyze: not implemented');
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
export {};
