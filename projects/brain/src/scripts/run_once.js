// Phase 2 runner: pull one queued task, reason, act, grade, log.
import 'dotenv/config';
import { supabaseAdmin } from '../lib/supabase';
import { BrainLoop } from '../agent/loop';
async function fetchOneQueuedTask() {
    const { data, error } = await supabaseAdmin
        .from('tasks')
        .select('*')
        .eq('status', 'queued')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
    if (error)
        throw error;
    return data;
}
async function main() {
    const task = await fetchOneQueuedTask();
    if (!task) {
        console.log('No queued tasks. Seed some with: npm run dev:seed:level1');
        return;
    }
    // Mark running to avoid double-processing in parallel.
    await supabaseAdmin.from('tasks').update({ status: 'running' }).eq('id', task.id);
    const loop = new BrainLoop();
    console.log('=== TASK ===');
    console.log({ id: task.id, task_type: task.task_type, task_input: task.task_input });
    const reasonOut = await loop.reason({ task, memory: { episodic: [], semantic: [], procedure: null } });
    console.log('\n=== REASON ===');
    console.log('confidence:', reasonOut.confidence);
    console.log('uncertainty_flags:', reasonOut.uncertainty_flags);
    console.log('chain_of_thought:', reasonOut.chain_of_thought);
    console.log('proposed_action:', reasonOut.proposed_action);
    const actOut = await loop.act({ task, reasonOut });
    console.log('\n=== ACT ===');
    console.log('result:', actOut.result);
    console.log('outcome_score:', actOut.outcome_score);
    const expected = task.task_input?.expected_answer;
    const ok = expected ? JSON.stringify(expected) === JSON.stringify(actOut.result) : null;
    console.log('\n=== GRADE ===');
    console.log('expected:', expected);
    console.log('correct:', ok);
    await supabaseAdmin
        .from('tasks')
        .update({ status: 'completed' })
        .eq('id', task.id);
}
main().catch(async (e) => {
    console.error(e);
    process.exit(1);
});
