# Content Agent Spec — Summary (v1.0)

Source: `content_agent_spec.docx` (converted to text)

## Core idea
The **Content Agent** is a *reasoning system that produces videos*, not a templated production pipeline. The spec’s central thesis: YouTube detects “pipeline” patterns; it rewards genuine editorial judgment + variation.

## Guiding principles
- **Research-first reasoning**: find a defensible angle that isn’t just the mainstream take.
- **Create → fail → learn**: failure is expected; log failures with enough detail to improve the next attempt.
- **YouTube-safe / monetization-grade**: design choices should inherently avoid low-quality automation signals.

## What YouTube detects (risk clusters)
High-risk signals called out:
- Visual fingerprinting (keyframe + thumbnail similarity) — flagged at >~47% similarity
- Audio fingerprinting (TTS artifacts, flat cadence)
- Script uniqueness (transcript similarity across channel and cross-channel)
- Engagement quality (retention curve + upload volume)

Medium-risk:
- Upload pattern regularity
- Metadata repetition
- Stock footage ratio (threshold cited ~25%; spec sets stricter)

Key warning: **YouTube reviews channels holistically**. Variation must exist across the channel, not just per-video.

## Four hard constraints (non-negotiable)
1) **Structural variation**
   - Maintain a **Format Registry**.
   - Each new video must use a different structure than the last video.
   - Format choice is a reasoning step.

2) **Visual originality**
   - Dominant layer must be original (charts/custom graphics/AI scenes/screen recordings).
   - Stock footage is **supplementary**; spec says max **20%**.
   - A **VisualPlan** is generated during research, before scripting.

3) **Voice with emotional direction**
   - Voice performance is directed per segment using emotion/pace/pause/emphasis.
   - Example mapping to ElevenLabs SSML shown.

4) **Publishing cadence & variation**
   - Max **3–4 videos/week**.
   - Randomize upload times within a window; enforce min gaps.
   - Random, human-looking filenames.

## Pipeline stages (reasoning steps)
Five stages with structured outputs:
1. Research
2. Editorial
3. Script (words + voice direction + visual plan)
4. Production
5. Quality gate (rework if it fails rubric)

### Stage 1 — Research
- Goal: find the **gap** vs mainstream takes.
- Uses web search iteratively.
- Minimum 4 searches before angle formation.
- If confidence < 0.6 after 8 searches → escalate / swap topic.
- Output: JSON with mainstream_take, our_angle, evidence, risks, confidence.

### Stage 2 — Editorial
- Choose sharpened angle + choose format from registry.
- Enforce “no recent format repetition.”
- Output: JSON including selected_format + visual_strategy + target length.

### Stage 3 — Script
- Produces segments with `voice` + `visual_ref`, plus title variants, description, tags, thumbnail concept.

## Suggested next implementation artifacts
- `format_registry.json` (seed with the included formats)
- `video_record.jsonl` logging outcomes: topic, angle, format, sources, retention, CTR, comments signals, failures
- `quality_gate_rubric.md` with pass/fail thresholds
- `visual_plan_renderer/` (Puppeteer chart templates, diagram templates)

## Open questions to resolve
- Which niches/channels are we targeting first?
- Which TTS provider/voice(s) and how many to rotate?
- What constitutes “recent formats” (last 3? last 5?)
- Minimum evidence standard per claim (citations requirement?)
