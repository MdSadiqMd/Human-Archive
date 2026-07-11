# Classifier Model Journey — Technical Decisions

---

## Approach 1 — Naive single-detector, uniform sampling, IMAGE mode

**Algo:** Run MediaPipe HandLandmarker on uniformly-sampled frames at fixed 2 fps, no temporal context, single confidence threshold, score-based routing with coarse thresholds.
**Changed from:** nothing — this was the initial build.
**Output stored:** `pipeline/output-1/clip/`
**Results:** 60 frames — `no_hands: 42 (70%), dexterous_pose: 12 (20%), easy: 6 (10%), low_lighting: 0, occluded: 0`

### What we built

**Sampling** (`video.py`)
- `cv2.VideoCapture` sequential read with a fixed step `= round(fps / sample_fps)`.
- `sample_fps=2.0` => every 15th frame of a 30 fps clip.
- Hard cap via `--max-frames`.
- No pass-1 scan, no event detection, no adaptive densification.

**Detector** (`detector.py`)
- Single `HandDetector` wrapping `mediapipe.tasks.python.vision.HandLandmarker`.
- Running mode: `RunningMode.IMAGE` — treats every frame as independent, no tracker reuse.
- Single confidence gate applied to all three internal thresholds: `min_hand_detection_confidence = min_hand_presence_confidence = min_tracking_confidence = 0.15`.
- Called as `detect(bgr)` with no timestamp (IMAGE mode does not need one).

**Feature extraction** (`features.py`)
- `image_stats(bgr)`: converts to grayscale, computes `mean_luminance`, `p10_luminance`, `contrast (std dev)`, `blur (Laplacian variance)`, `histogram_spread (normalized entropy over 32 bins)`.
- `hand_features(label, score, landmarks)`: builds `HandFeatures` — bounding box from landmark extremes, `out_of_frame_landmarks` (count with x/y outside [0,1]), `border_clipping` (fraction of box sides within 2% of image edge), `articulation` (sum of joint bend angles across 5 finger chains normalized to `pi*3*5`), `finger_spread` (std/mean of inter-fingertip distances).

**Classifier** (`classifier.py`)
- `FrameClassifier` holds a single `HandDetector`.
- `extract_frame_features(bgr)` calls detector + assembles `FrameFeatures`.
- `_hand_evidence(f)`: scores best hand by `0.5*handedness_score + 0.3*completeness + 0.2*size_signal` where `completeness = 1 - out_of_frame/21` and `size_signal = clip(box_area/0.05, 0, 1)`.
- `_score_low_light(f)`: weighted sum `0.5*(1-lum/0.28) + 0.25*(1-p10/0.05) + 0.25*(1-contrast/0.12)`.
- `_score_occluded(f, temporal_dropout, model_disagreement)`: per-hand `0.35*partial_loss + 0.25*low_conf + 0.25*temporal_dropout + 0.15*border_clipping + 0.2*disagreement`.
- `_score_dexterous(f, jitter)`: per-hand `0.45*articulation + 0.35*finger_spread + 0.2*self_overlap + 0.15*jitter` (IoU between hand bboxes for self-overlap).
- `_score_easy(evidence, low, occ, dex)`: `evidence * (1 - max(low,occ,dex))` if evidence >= 0.55 else 0.
- Decision: if `evidence < 0.45` -> `no_hands`; else argmax of `{low_lighting, occluded, dexterous_pose}` if dominant >= 0.40; else `easy`.

**Go pipeline** (`cmd/pipeline/main.go`)
- Downloads up to `--limit` `.mp4` files from S3 with `--workers` concurrent goroutines.
- Each downloaded video passed to `VideoClassifier.process()` via `classify-video` CLI subprocess.
- Output written to `outputRoot/<video_stem>/frames/<label>/*.jpg` and `report.json`.
- Bug: two videos with the same basename (e.g. `clip.mp4`) both wrote to the same output dir because stem was just `filepath.Base(key)` stripped of extension.

### Problems observed

1. `low_lighting` and `occluded` never fired — thresholds too high relative to actual score ranges.
2. 70% `no_hands` — missed many frames where hands were present but partially out of frame or in a dark area.
3. No temporal context — jitter was always 0 because no prior bbox to compare.
4. `model_disagreement=0.0` hardcoded — single detector means no disagreement signal.
5. Low-light frames got classified `no_hands` instead of `low_lighting` because darkness killed detector confidence (evidence -> 0) before the low-light score could win.
6. Output dir collision: both `ambulance_emt_01/clip.mp4` and `ambulance_emt_02/clip.mp4` wrote to `output/clip/`.

---

## Approach 2 — Hybrid sampler + VIDEO mode + ensemble disagreement

**Algo:** Two-pass hybrid sampler (1 fps uniform + 5 fps event bursts + 10 fps dense transitions); MediaPipe in VIDEO mode with per-frame timestamps; strict primary + permissive secondary detector pair; model disagreement wired into occlusion score; separate confidence gates.
**Changed from:** Approach 1 — complete rewrite of sampler, detector, classifier core.
**Output stored:** `pipeline/output-2/ambulance_emt__ambulance_emt_01__clip/`
**Results:** 250 frames — `no_hands: 97 (38.8%), dexterous_pose: 79 (31.6%), low_lighting: 48 (19.2%), easy: 17 (6.8%), occluded: 9 (3.6%)`

### What changed

#### Sampler (`sampler.py`) — new file

Two-pass `HybridSampler`:

**Pass 1 — coarse scan** (`scan()`)
- Reads every `fps/scan_fps` frames (default every 30th = 1 fps for 30 fps video).
- Each scan frame resized to 160x90 before any computation.
- Computes:
  - `brightness = gray.mean() / 255.0`
  - `motion = mean(absdiff(gray, prev_gray)) / 255.0`
  - `presence = _skin_presence(small)` — combined HSV + YCrCb skin mask; HSV hue ranges (0-25) and (160-179) for red-pink tones with saturation 30-180 and value 60-255; YCrCb Cr in [133,173] and Cb in [77,127]. Returns fraction of pixels matching either mask, normalized to [0,1].
- Stores as list of `ScanRow(frame_index, timestamp_s, presence, brightness, motion)`.

**Pass 2 — event detection + plan** (`_detect_events()`, `plan()`)
- Event types:
  - `hand_event`: `presence` crosses `presence_threshold` (default 0.5) in either direction, OR `motion` increases by >0.05 between consecutive scan rows.
  - `confidence_drop`: `abs(brightness_delta) > 0.15` between consecutive scan rows (sharp light change).
- For each event, a window `[ts - context_before_s, ts + context_after_s]` (default +-3 s) is sampled at `event_fps` (5 fps) for `hand_event` or `dense_fps` (10 fps) for `confidence_drop`.
- Frames within 0.4 s of the event timestamp tagged `hand_event`; outer window frames tagged `transition_window`.
- Dedup: same frame index can appear from multiple events; higher-priority reason wins (`confidence_drop > hand_event > transition_window > uniform`).
- Base 1 fps uniform grid applied first; event frames promoted over it.
- `max_frames` cap: hard events kept whole; uniform frames thinned via `linspace` index selection.

**Frame iterator** (`iter_planned_frames()`)
- Sequential read with seek-ahead: when gap to next planned frame > 30 frames, `cap.set(CAP_PROP_POS_FRAMES, next_target)` to skip.
- Avoids O(n) reads for the full 9000-frame clip when only 250 frames are needed.

Each output `Sample` carries: `frame_index`, `timestamp_s`, `reason`, `sample_rate_used`, `event_id`.

#### Detector (`detector.py`) — redesigned

**VIDEO running mode**
- `HandDetector.__init__` accepts `video_mode: bool = True`.
- When `video_mode=True`, uses `RunningMode.VIDEO` and calls `detect_for_video(mp_image, int(timestamp_ms))`.
- Timestamp must be strictly monotonically increasing — enforced by computing `ts_ms = int(sample.timestamp_s * 1000)`.
- VIDEO mode lets the tracker reuse spatial continuity between frames instead of re-detecting from scratch on every frame. Reduces landmark jitter and improves tracking through brief occlusions.

**Three separate confidence gates**
- Constructor now takes `min_detection`, `min_presence`, `min_tracking` independently.
- Primary: all three at 0.5 (strict, high precision).
- Secondary: all three at 0.15 (permissive, high recall).

**`DisagreementEnsemble`**
- Holds two `HandDetector` instances: `primary` and `secondary`.
- `detect(bgr, timestamp_ms)` -> `(r2, disagreement, n1, n2)`.
  - `n1 = len(r1.hand_landmarks)` (primary count).
  - `n2 = len(r2.hand_landmarks)` (secondary count).
  - `disagreement = max(0, n2 - n1) / 2.0` — how many more hands the permissive detector sees vs the strict one. Normalised to [0, 1] for <=2 hands.
  - Returns `r2` (secondary result) as the detection output since it has higher recall.

#### Classifier (`classifier.py`) — updated

- `FrameClassifier` now holds a `DisagreementEnsemble` instead of a single `HandDetector`.
- `detect_ensemble(bgr, timestamp_ms)` delegates to `ensemble.detect()`.
- Retuned `DEFAULTS`:
  - `no_hands_threshold=0.6` (evidence < 0.4 -> no_hands gate).
  - `low_light_mean=0.38, low_light_p10=0.08, low_light_contrast=0.14` — looser than approach 1 so more frames score high enough to win.
  - `easy_max_hard=0.32` — lower; harder for a frame to reach `easy`.
  - `disagreement_weight=0.35` — fed into occlusion score.
- `_score_occluded()` now includes `disagreement` path when `f.hands` is empty (secondary sees hands, primary doesn't — classic occlusion signature: `base = w_temp * temporal_dropout + disagreement_weight * disagreement`).
- Decision gate changed: if `evidence < gate AND s_low < 0.5 AND disagreement < 0.4` -> `no_hands`. This lets dark frames with weak evidence but high low-light score escape the no_hands bucket.

#### Go pipeline — output dir fix

- `stemFromKey(key)` changed from `filepath.Base(key)` to full S3 key path with `/` replaced by `__` (e.g. `ambulance_emt/ambulance_emt_01/clip.mp4` -> `ambulance_emt__ambulance_emt_01__clip`).
- Runner struct fields renamed: `SampleFPS -> BaseFPS`, `MinConf` removed, new fields: `EventFPS`, `DenseFPS`, `ContextS`, `ScanFPS`, `PrimaryConf`, `SecondaryConf`, `PresenceThresh`, `NoVideoMode`.

### Problems observed

1. Frame `0000366` in `easy/` — one hand visible but the other clearly off-screen. Occlusion score didn't fire because `out_of_frame_landmarks = 0` for the visible hand (all 21 landmarks within frame bounds). The model doesn't see the missing second hand as a signal; it only scores the hand it found.
2. Frame `0000486` in `easy/` — two hands visible but extremely blurry/unclear. Articulation and spread scores were too low because blur degrades landmark quality, making the pose look geometrically simple rather than dexterous.
3. Frame `0000411` in `easy/` — no hands present but classified easy because secondary detector produced a weak false-positive hit (handedness_score ~0.5) on a skin-coloured object; that single hit pushed evidence above the easy threshold.
4. Frame `0001752` in `no_hands/` — hands clearly present; primary missed them and secondary picked them up, but `disagreement = 0.5` wasn't enough to overcome the no_hands gate when evidence was below 0.4.

---

## Approach 3 — Blur-aware scoring, CLAHE preprocessing, secondary-only penalty, dark-first policy

**Algo:** CLAHE on LAB L-channel for dark frames before detection; weak-handedness score penalty; secondary-only detection penalty on evidence; blur Laplacian term added to occlusion + dexterity scores; dark-first policy (high low_light score overrides no_hands gate regardless of evidence); separate primary/secondary hand merging with IoU dedup.
**Changed from:** Approach 2 — targeted fixes for the four observed misclassification types.
**Output stored:** `pipeline/output-2/` (approach 2 moved there), new run -> `pipeline/output/`

### What changed

#### `detector.py` — `enhance_dark()` added

```python
def enhance_dark(bgr: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    l = clahe.apply(l)
    return cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)
```

- Converts BGR -> LAB colour space, applies CLAHE only to the L (luminance) channel.
- `clipLimit=3.0`: maximum slope of the cumulative histogram per tile; prevents noise amplification in very dark regions.
- `tileGridSize=(8,8)`: 8x8 non-overlapping tiles for contextual equalisation.
- Merges enhanced L back with unchanged a and b channels, converts LAB -> BGR.
- Applied in `video.py` when `stats.mean_luminance < 0.32` before passing frame to both detectors.
- Original frame (not CLAHE-enhanced) is still written to disk so annotators see the real image. `clahe_applied` bool stored in per-frame feature dict.

**`DisagreementEnsemble.detect()` return signature changed**
- Now returns `(r1, r2, disagreement, n1, n2)` — 5-tuple.
- Previously returned `(r2, disagreement, n1, n2)` — 4-tuple.
- `r1` = strict primary result; `r2` = permissive secondary result.
- Reason: `video.py` needs both separately to merge hands by IoU dedup.

#### `video.py` — hand merging + CLAHE branch

**CLAHE branch:**
```python
if stats.mean_luminance < 0.32:
    det_input = enhance_dark(frame)
    used_clahe = True
```

**Hand merging** (fixes approach 2 problem 3 — false-positive easy frames):
```python
merged = list(primary_hands)
for sh in secondary_hands:
    if all(bbox_iou(sh.bbox, ph.bbox) < 0.3 for ph in primary_hands):
        merged.append(sh)
```
- Primary hands (strict detector, high confidence) kept unconditionally.
- Each secondary hand added only if IoU < 0.3 with every primary detection — deduplicates overlapping detections while topping up with secondary-only finds (occluded hands that primary missed).
- `feats = FrameFeatures(image=stats, hands=merged)` — uses merged list, not just secondary.
- `hand_evidence()` and `classify()` receive explicit `primary_count=n_primary, secondary_count=n_secondary` from the 5-tuple.

#### `classifier.py` — full threshold rework + blur + secondary penalties

**`DEFAULTS` changes (approach 2 -> approach 3)**

| Parameter | Approach 2 | Approach 3 | Reason |
|---|---|---|---|
| `no_hands_evidence_gate` | `0.40` (implicit) | `0.42` | Small tightening |
| `weak_hd_threshold` | none | `0.65` | Halves contribution of low-confidence detections |
| `secondary_only_penalty` | none | `0.55` | Scales evidence when only secondary fired |
| `low_light_mean` | `0.38` | `0.32` | Tighter; EMT footage often 0.28-0.35 |
| `low_light_p10` | `0.08` | `0.06` | Tighter bottom-decile threshold |
| `dark_priority_threshold` | none | `0.35` | Low_light above this skips no_hands gate |
| `weights_occ` | 4-tuple | 5-tuple `(0.28, 0.2, 0.18, 0.18, 0.16)` | Added blur component |
| `weights_dex` | 3-tuple | 4-tuple `(0.35, 0.28, 0.22, 0.15)` | Added blur component |
| `disagreement_weight` | `0.35` | `0.4` | Stronger disagreement signal |
| `easy_max_hard` | `0.32` | `0.28` | Even harder to reach easy |
| `blur_sharp_cutoff` | none | `350.0` | Laplacian var >= 350 = fully sharp |
| `blur_blurry_cutoff` | none | `80.0` | Laplacian var <= 80 = fully blurry |

**`_blur_score(blur, cfg)`** — new helper function:
```python
if blur >= blur_sharp_cutoff: return 0.0
if blur <= blur_blurry_cutoff: return 1.0
return (sharp - blur) / (sharp - blurry)  # linear interpolation
```
- Laplacian variance is computed on the original (non-CLAHE) grayscale frame in `image_stats()`.
- Used as additive component in both `_score_occluded` and `_score_dexterous`. A blurry frame with detected hands is harder to annotate regardless of pose; blur is a detector-failure proxy driven by motion blur and focus issues.

**`hand_evidence(f, primary_count, secondary_count)`** — fixes approach 2 problem 3:
- **Weak handedness penalty**: if `h.handedness_score < weak_hd_threshold (0.65)`, score is halved: `hd = h.handedness_score * 0.5`. Prevents a secondary-only detection with score 0.55 from driving evidence above the gate.
- **Secondary-only penalty**: if `primary_count == 0 and secondary_count > 0`, multiply final `best` by `secondary_only_penalty (0.55)`.
- Combined effect: secondary-only detection with handedness_score=0.55 gives evidence approx `0.55 * 0.275 + 0.25 * completeness + 0.2 * size ~ 0.40 * 0.55 = 0.22`. Below the 0.42 gate -> correctly no_hands or occluded.

**`_score_occluded(...)` with `primary_count`, `secondary_count`** — fixes approach 2 problem 4:
- `secondary_only = 1.0 if (primary_count == 0 and secondary_count > 0) else 0.0`. Adds `+0.15` to per-hand score.
- This captures the "primary missed it, secondary found it" signature as a direct occlusion signal. Combined with disagreement_weight, frames like `0001752` now have occlusion score high enough to escape `no_hands`.

**`_score_dexterous(f, jitter)`** with blur — fixes approach 2 problem 2:
- 4-weight tuple: `w_art, w_spread, w_ovl, w_blur = (0.35, 0.28, 0.22, 0.15)`.
- `blur` component via `_blur_score()`. Blurry frames with hands now score higher on dexterity. Frame `0000486` (two blurry hands) gets the blur component pushing score above `easy_max_hard`.

**`classify()` dark-first policy** — fixes approach 2 problem 1 (dark frames with hand evidence going to no_hands):
```python
if s_low > dark_priority_threshold:
    pass  # skip no_hands gate entirely
elif evidence < gate:
    if s_low < 0.5 and model_disagreement < 0.4:
        return "no_hands", scores, evidence
```
Full decision order:
1. Compute `s_nohands, s_low, s_occ, s_dex, s_easy`.
2. If `s_low > 0.35` (dark-first): skip the evidence gate, proceed to argmax. Dark frames with any hand hint classify as `low_lighting`.
3. Else if `evidence < 0.42` -> `no_hands`.
4. `dominant = argmax{low_lighting, occluded, dexterous_pose}`.
5. If `dominant_score >= 0.28` -> return dominant.
6. If evidence still below gate -> `no_hands`.
7. Else -> `easy`.

---

## Approach 4 — Two-pass bidirectional temporal presence (short-gap track interpolation)

**Algo:** Split into two passes. Pass 1 detects on every planned frame and caches per-frame local detection strength + encoded JPEG. Pass 2 decides presence by **short-gap temporal bridging** — a frame with no local detection is `occluded` iff a confident detection exists within a short time gap (track interpolation), otherwise `no_hands`; difficulty is attributed only after presence is established; `easy` is a strict all-gates-pass residual.
**Changed from:** Approach 3 — the no_hands/occluded decision was rebuilt from scratch because approach 3 decided it on a razor-thin per-frame evidence threshold, which the data showed was pure noise (frames with lower evidence were labelled occluded while higher-evidence ones were labelled no_hands).
**Output stored:** `pipeline/output/` (approach 3 moved to `pipeline/output-3/`).
**Results:** 250 frames — `no_hands: 78 (31.2%), low_lighting: 72 (28.8%), occluded: 64 (25.6%), dexterous_pose: 36 (14.4%), easy: 0`.

### Root cause diagnosis (why approach 3 was worse)

Web + first-party evidence:
- BlazePalm (MediaPipe's palm detector) **fails entirely under occlusion** — when the palm is partially occluded it produces NO landmarks. So "detector saw nothing" is byte-identical for a truly empty frame and an occluded hand. A single frame cannot separate `no_hands` from `occluded`. ([research: Real-time Hand Tracking under Occlusion, MediaPipe Hands](https://arxiv.org/abs/1704.02201))
- The literature separates them with **temporal continuity** (IoU matching / Kalman / track interpolation), never single-frame confidence.
- Our own `output-3` data proved the failure: borderline frames all had `p=0, s=1, disag=0.5`; whether they landed in `no_hands` vs `occluded` was decided by evidence noise around the 0.42 gate — e.g. `idx=609 ev=0.24 -> occluded` while `idx=384 ev=0.28 -> no_hands` (lower-evidence frame got the harder label). Pure coin-flip.
- Visual audit found a hard miss: `idx=2067` had two clearly visible hands (reaching arm + fingers at bottom edge) but both detectors returned nothing (`p=0, s=0`) so it was dumped into `no_hands`.

### What changed

#### `video.py` — rewritten as an explicit two-pass driver

**Pass 1 `_detect_pass()`** — for every planned frame:
- compute `image_stats`, CLAHE-boost dark frames (`mean_luminance < dark_lum_for_clahe=0.32`) before detection,
- run `DisagreementEnsemble` (returns `r_primary, r_secondary, disagreement, n_primary, n_secondary`),
- merge hands: keep all primary, add each secondary hand only if IoU < 0.3 with every primary hand,
- compute `local_strength` (primary-anchored; halved when only the permissive detector fired),
- pick `best_box` (highest-handedness primary hand, else first merged hand),
- JPEG-encode the ORIGINAL frame with `cv2.imencode` and store the bytes (≈350 KB/frame → ~90 MB for 250 frames, vs ~690 MB if raw frames were cached),
- store all of the above in a `_Record`.

**Pass 2** — for each record:
- `_track_support(records, i, conf_thr)` scans neighbours within `±temporal_window_s=2.0` and returns:
  - `track_support` = strongest neighbour `local_strength` (reporting/scoring only),
  - `nearest_conf_dt` = seconds to the nearest neighbour whose `local_strength ≥ track_strong (0.55)` — a confident anchor. This is the bridging signal.
- `jitter` = `1 - mean IoU(best_box, immediate-neighbour best_box)` (bidirectional, within window).
- call `classify(...)` with `local_strength`, `track_support`, `nearest_conf_dt`, `model_disagreement`, `jitter`, counts.
- write the cached JPEG bytes straight into `frames/<label>/`.

`nearest_conf_dt` is persisted per frame in the JSON report for auditability.

#### `classifier.py` — presence rebuilt around short-gap bridging

New/changed `DEFAULTS`:
- `present_local=0.50` — local strength that means "hand clearly here".
- `track_strong=0.55` — neighbour strength that counts as a confident anchor.
- `bridge_max_s=0.7` — max gap for pure track interpolation; a per-frame hint doubles it to 1.4 s.
- `secondary_local_factor=0.5` — halves local strength when only the permissive detector fired.
- `hard_dark_lum=0.20` — floor: frames darker than this get a strong low-light score regardless of contrast.
- `dark_thr=0.35`, low-light config restored to approach-2 values (`low_light_mean=0.38`, p10 term back, `weights_low=(0.5,0.25,0.25)`) because the user confirmed approach-2's low_lighting bucket was good.
- occlusion weights `(0.34,0.22,0.22,0.22)` = partial-loss / border-clip / blur / low-conf; `disagreement_weight=0.35`; `occ_min=0.30`.
- dexterity weights `(0.4,0.32,0.28)` = articulation / spread / self-overlap; `dex_min=0.30`.
- strict easy gates: `easy_min_handedness=0.70`, `easy_max_lowlight=0.18`, `easy_max_blur=0.25` (blur SCORE), `easy_max_occ=0.25`, `easy_max_dex=0.25`.

`local_strength()` — primary-anchored: `0.6·handedness + 0.25·completeness + 0.15·size`, halved if `primary_count==0 and secondary_count>0`.

`classify()` — presence then difficulty:
```
local_present = local_strength >= present_local          # 0.50
has_hint      = bool(hands) or disagreement > 0
short_gap     = nearest_conf_dt <= bridge_max_s          # 0.7 s
hinted_gap    = has_hint and nearest_conf_dt <= 1.4 s    # 2 x bridge

if local_present:            present, lost = True,  False
elif short_gap or hinted_gap: present, lost = True,  True   # dropout in a live track
else:                        present, lost = False, False

if not present:                    -> no_hands
if s_low  >= dark_thr (0.35):      -> low_lighting        # dark wins (classifier.md)
if lost:                           -> occluded            # present but detector lost it, not dark
if s_dex >= dex_min and s_dex>=s_occ: -> dexterous_pose
if s_occ >= occ_min:               -> occluded
if _is_easy(...):                  -> easy                # strict: primary+conf+complete+bright+sharp
else: (occluded if s_occ>=s_dex else dexterous_pose)      # clear but fails easy -> nearest hard
```

The decisive change: `no_hands` vs `occluded` is now a function of `nearest_conf_dt` (a physical temporal-continuity measurement), not of a fragile per-frame evidence threshold. A single dropped frame between confident detections is `occluded`; a run of nothing far from any detection is `no_hands`.

### Verification (visual, on actual pixels)

- `idx=2067` (approach-3 miss, two visible hands, `p=0,s=0`): `dt=0.5` → now correctly `occluded`.
- `idx=252`, `idx=318` (`occluded`): confirmed hands gripping/reaching a container, motion-blurred and object-occluded — genuine hard frames.
- `idx=678`, `idx=543`, `idx=0` (`no_hands`): confirmed empty or hand-out-of-frame at edge (`dt=None / 1.4 / 2.0` → correctly not bridged).
- `easy=0`: acceptable — this cooking footage has near-constant hand-object manipulation, so a truly clean/sharp/well-lit/unoccluded hand frame is genuinely rare. Strict gate chosen deliberately after the user reported approach-2/3 easy frames were "definitely not easy"; better to under-populate easy than mislabel.

---

## Comparison table — same 5-minute clip (`ambulance_emt_01/clip.mp4`, 9000 source frames, 30 fps)

| | Approach 1 (`output-1`) | Approach 2 (`output-2`) | Approach 3 (`output-3`) | Approach 4 (`output/`) |
|---|---|---|---|---|
| Sampled frames | 60 | 250 | 250 | 250 |
| Sampling strategy | uniform 2 fps | 1 fps + event bursts | 1 fps + event bursts | 1 fps + event bursts |
| Detector mode | IMAGE | VIDEO | VIDEO + CLAHE | VIDEO + CLAHE, two-pass |
| Detector instances | 1 | 2 (strict+permissive) | 2 + IoU merge | 2 + IoU merge |
| no_hands vs occluded rule | evidence gate | evidence gate | evidence gate (noisy) | **bidirectional temporal bridging** |
| `no_hands` | 42 (70%) | 97 (38.8%) | 95 (38.0%) | 78 (31.2%) |
| `easy` | 6 (10%) | 17 (6.8%) | 2 (0.8%) | 0 (0%) |
| `dexterous_pose` | 12 (20%) | 79 (31.6%) | 51 (20.4%) | 36 (14.4%) |
| `low_lighting` | 0 | 48 (19.2%) | 77 (30.8%) | 72 (28.8%) |
| `occluded` | 0 | 9 (3.6%) | 25 (10.0%) | 64 (25.6%) |
| False-positive easy | high | medium | very low | none (strict gate) |
| occluded↔no_hands confusion | n/a | medium | **worse (noise)** | **resolved (temporal)** |

---

## Key invariants and non-obvious constraints

- **MediaPipe VIDEO mode requires strictly monotonically increasing timestamps.** If `timestamp_ms` ever equals or decreases from the previous call, the landmarker raises internally. The sampler guarantees this because plans are sorted by `frame_index` and `ts_ms = int(sample.timestamp_s * 1000)`.
- **CLAHE is applied only to the detector input, not to the saved frame.** `cv2.imwrite` always receives the original `frame` variable. Annotators see real images; the CLAHE flag is in the JSON report for debugging.
- **Blur Laplacian is measured on the original frame, not the CLAHE-enhanced one.** `image_stats(frame)` is called before `enhance_dark()`. This gives a true blur reading unaffected by contrast enhancement.
- **`presence_threshold` in the sampler defaults to 0.5 but the raw skin-mask fraction for typical indoor hands is 0.04-0.12.** The CLI default was corrected to `0.06` so the sampler actually triggers events in ambulance footage rather than treating all frames as no-presence.
- **Secondary-only evidence arithmetic.** A secondary-only detection with `handedness_score=0.55`: after weak penalty `0.55 * 0.5 = 0.275`; evidence `= 0.55 * 0.275 + 0.25 * completeness + 0.2 * size`. Worst case (full hand in frame, size=1): `0.151 + 0.25 + 0.2 = 0.601`; times secondary penalty `0.601 * 0.55 = 0.33`. Below gate 0.42. Primary-confirmed detection with score 0.8 is not penalised: evidence `= 0.55 * 0.8 + 0.25 * 1 + 0.2 * 1 = 0.44 + 0.25 + 0.2 = 0.89`. Well above gate.
- **The two S3 videos (`ambulance_emt_01/clip.mp4` and `ambulance_emt_02/clip.mp4`) contain identical footage.** Both videos produce identical label distributions and identical sampler plans. This was confirmed by comparing report.json label counts and the first 20 frame labels across both videos.
- **BlazePalm fails ENTIRELY under occlusion (no partial landmarks).** This is why single-frame confidence cannot separate `no_hands` from `occluded`, and why approach 4 uses temporal bridging instead. ([source](https://arxiv.org/abs/1704.02201))
- **Approach 4 caches JPEG-encoded bytes (not raw frames) between the two passes.** Raw 720p frames for 250 samples would be ~690 MB; `cv2.imencode('.jpg', ...)` brings it to ~90 MB and the bytes are written straight to disk in pass 2 (no re-decode).
- **`nearest_conf_dt` is the presence signal, not `track_support`.** `track_support` (max neighbour strength in ±2 s) is kept only for the JSON report; the actual no_hands/occluded decision uses `nearest_conf_dt` (time to nearest confident anchor) against `bridge_max_s`. A confident hand 2 s away does NOT bridge; one 0.5 s away does.
- **The footage labelled `ambulance_emt` is actually egocentric kitchen/cooking footage** (spices, containers, bangled wrists), with near-constant hand-object interaction — which is why `occluded` is a large bucket and `easy` is near-empty under a strict gate.
- **`easy` is 0 in approach 4** by design. The strict `_is_easy()` gate requires: primary detector fired, `handedness_score >= 0.70`, all 21 landmarks within frame bounds, `mean_luminance >= 0.38`, blur score <= 0.25, occlusion score <= 0.25, dexterity score <= 0.25. This footage never satisfies all conditions simultaneously — correct behaviour, not a bug.

---

## Model

**MediaPipe Hand Landmarker** (`models/hand_landmarker.task`, ~7.5 MB, float16-quantised TFLite). Two sub-models bundled together:

1. **BlazePalm** — palm detector, outputs bounding boxes per hand
2. **Hand landmark model** — 21 3D keypoints per detected hand (wrist, knuckles, fingertips)

`DEFAULT_MODEL` in `detector.py` resolves via `Path(__file__).resolve().parents[1] / "models" / "hand_landmarker.task"`. Downloaded from `storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`. Runs on CPU via XNNPACK.

---

## Pipeline → Backend → Frontend Integration

**Approach:** Wire the pipeline output directory into the backend via an `IngestDirectory` service that walks `*/report.json`, parses each report, and inserts video + frames into PostgreSQL in a transaction.

**Key decisions:**
- **Idempotent ingestion:** `INSERT ... ON CONFLICT (stem) DO NOTHING` — re-ingesting the same directory is safe.
- **Filename reconstruction:** Frame JPEGs are named `{video_basename}_{frame_index:07d}_{sample_reason}.jpg` on disk. The ingest service reconstructs this from the report's `video` path and each frame's `frame_index` + `sample_reason`.
- **Static frame serving:** `FRAMES_DIR` mounted read-only in Docker at `/data/output`. Backend serves `/frames/*` via `http.FileServer` behind auth middleware. As of 2026-07-03, the pipeline also uploads frames to S3 bucket `demo-sadiq` at key `{stem}/frames/{label}/{filename}` when `-dest-bucket` is set. When `S3_BUCKET` env var is configured, the backend proxies `/frames/*` through S3 `GetObject` (with local filesystem fallback), rather than serving from disk.
- **DB-level locking:** Annotation submission uses `SELECT ... FOR UPDATE` on the assignment row to prevent double-submission by concurrent annotators.
- **Backend route structure:** Admin routes under `/admin/` with `RequireAdmin` middleware. Annotator queue routes under `/queue/` with `RequireAuth` middleware.
- **Frame image URL pattern:** `/frames/{stem}/frames/{label}/{filename}` — matches on-disk layout under the `FRAMES_DIR` root.
- **No bounding box canvas in this iteration:** Per user request, annotations use simple L/R/no-hands toggles instead of bounding box drawing.

---

## 2026-07-03: Cross-Account S3 Access for Deployment

**Decision**: Deploy backend on personal AWS account while accessing S3 data from humanarchive account.

**Reason**: The humanarchive IAM user only has S3 permissions, not EC2/SSM. Personal account used for compute.

**Implementation**: 
- EC2 deployed via Terraform on personal account (812430678807)
- S3 credentials for humanarchive account (575701028678) passed via environment variables
- Source bucket: `demo-hand-tracking-bucket` (read-only videos)
- Destination bucket: `demo-ha-sadiq` (extracted frames)

---

## 2026-07-03: Go 1.25 Toolchain Compatibility

**Decision**: Use `GOTOOLCHAIN=auto` in Dockerfile to allow automatic toolchain download.

**Reason**: Some dependencies (pgx v5.7+, x/crypto) require Go 1.25+, but base image is Go 1.24.

**Implementation**: Added `ENV GOTOOLCHAIN=auto` to backend Dockerfile.
