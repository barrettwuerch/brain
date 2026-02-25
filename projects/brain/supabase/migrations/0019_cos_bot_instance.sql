-- 0019_cos_bot_instance.sql

-- Ensure CoS bot exists in bot_states (Pass 1 state machine auto-creates too; this is explicit).
insert into public.bot_states (bot_id, agent_role, desk, current_state)
values ('cos-bot-1', 'chief_of_staff', 'all_desks', 'exploiting')
on conflict (bot_id) do nothing;
