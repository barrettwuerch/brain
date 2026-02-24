# THE BRAIN — Spec Summary (v1)

Source: `brain_spec.docx` → `projects/brain/spec/brain_spec.v1.txt`

## Purpose
Design an agent that **gets smarter over time** by building memory + reasoning quality measurement + generalization, without model fine-tuning.

Core triad:
- **Memory**: remembers what happened, why it failed, and what worked across runs
- **Reasoning quality**: can tell if it’s improving vs. getting lucky
- **Generalization**: transfers learning from Task A → Task B

## Core loop (ReAct + Reflexion)
Five-step loop (decisions change over time, loop stays constant):

REASON → ACT → OBSERVE → REFLECT → STORE

- **ReAct**: externalized reasoning before each action (transparent + debuggable)
- **Reflexion**: post-run self-evaluation + verbal guidance for next attempt

Claimed results cited: self-reflection improves accuracy (p < 0.001) across nine LLMs; ReAct+Reflexion combined solved 130/134 sequential decision tasks (per spec).

## Memory architecture (3-layer)
The spec emphasizes that **one memory type is not enough**.

### Layer 1: Episodic (what happened)
- Full run records (task, reasoning, action, observation, reflection, outcome)
- TTL-based pruning
- Retrieval uses **semantic similarity + recency + importance** weighting

Episode fields include: `task_type`, `task_input`, `reasoning`, `action_taken`, `observation`, `reflection`, `outcome`, `outcome_score`, `reasoning_score`, `error_type`, `ttl_days`.

### Layer 2: Semantic (what the agent learned)
- Distilled facts extracted from multiple episodes
- Confidence-scored, updated over time
- Retired when violated too often

Fields: `fact`, `domain`, `supporting_episode_ids`, `confidence`, `times_confirmed`, `times_violated`.

### Layer 3: Procedural (how to do things well)
- Learned approaches/playbooks per task type
- Injected into REASON prompts

Fields: `task_type`, `approach[]`, `cautions[]`, `success_pattern`, `failure_pattern`, `avg_success_rate`.

## Memory lifecycle / hygiene
Key warnings:
- STORE is where most agents fail (log everything / retrieve nothing useful).
- Must be disciplined about forgetting.

Rules outlined:
- Episode TTL varies by outcome (incorrect kept longer)
- Prompt memory budget capped (e.g., 3k tokens) and prioritized
- Semantic facts deduped by similarity; updated not duplicated
- Consolidation/pruning happens in background (nightly), not in-run

## What’s next to implement (if we build this)
- Define canonical `task_type` taxonomy
- Implement episode store + retrieval scoring (sim+recency+importance)
- Build nightly consolidation job (episodes → semantic facts → procedures)
- Build a reasoning-quality evaluator (calibration: self-score vs outcome)
- Add metrics dashboard over time: accuracy by task_type, transfer tests, calibration curves
