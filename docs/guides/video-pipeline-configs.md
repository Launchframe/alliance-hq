# Video pipeline configs & experiments

Platform maintainers tune **frame extraction** (`scene` / `fps`) and graduate winners without requiring officers to review shadow jobs.

## Standing assignment vs active experiment

| Mechanism | When it applies | What it stamps |
|-----------|-----------------|----------------|
| **Config assignment** (`config_assignments`) | No active experiment traffic for this upload, or control arm | Primary job `passKey` + `extractionConfigJson` |
| **Active experiment arm** | Upload rolls into campaign (`trafficPercent` + arm `trafficWeight`) | Primary job uses **variant** arm parse config; **control** arm uses standing assignment / `DEFAULT_PRIMARY_PASS` |
| **Promote** | After conclude (or anytime) | Writes standing assignment for post-campaign default |

**Officers always review the primary job.** Ratings (`thumbs_up` / `thumbs_down`) and quality scores attach to that primary. Experiment arm analytics aggregate from primary jobs only.

Promote is **not** required for an experiment to change officer-facing OCR. Promote graduates a winner to the standing default when the campaign is done (or as the default outside experiment traffic).

## Shadow jobs

Extraction shadows (`passRole: "shadow"`, default `scene_0.1`) are for **engine / pass comparison**, not for A/B of experiment arm configs. Variant arm `configId` does **not** drive shadow extraction.

Roster video tandem OCR (Ashed primary vs Tesseract shadow) is a separate path (`tesseract_shadow` + `ocr_eval_snapshots`).

## Operator checklist (deposit-slip denser fps example)

1. Create parse config `fps_3` (mode `fps`, `sampleFps: 3`) under Admin → Parse configs.
2. Create campaign on `bank-deposit-slip-history`, traffic 100% (or less), arms: Control (no config) + Variant (`fps_3`).
3. Start campaign. New uploads’ **primary** jobs show `passKey` matching the assigned arm on `/admin/video-jobs`.
4. Officers rate/submit primaries → experiment detail RATED / 👍% / AVG QUALITY update.
5. Conclude; optionally **Promote** variant → standing assignment for future uploads outside experiments.

## Code entry points

- `resolvePrimaryExtractionForUpload` / `resolvePrimaryExtractionStamp` — `src/lib/video/experiment-assignment.ts`
- Stamp at enqueue — `finalize-video-upload.ts`, `activate-pending-upload.ts`
- Arm analytics — `experiment-detail-analytics.ts` (primary only)
- Shadow enqueue — `enqueue-shadow-pass.ts` (fixed `SHADOW_PASS_AB`, not arm config)
