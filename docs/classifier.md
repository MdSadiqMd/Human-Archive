make it a **two-stage frame classifier**: first decide **no_hands vs hands-present**, then, only if hands are present, assign **occluded / low_lighting / dexterous_pose / easy** by fusing model outputs, temporal consistency, and image-quality signals. [developers.google](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker)

## Final classification contract
For every frame, output exactly one of:
- `no_hands`
- `low_lighting`
- `occluded`
- `dexterous_pose`
- `easy`

That means the classifier is not just “difficulty detection.” It is a **mutually exclusive routing policy** that decides the dominant reason a frame is hard, with `no_hands` taking priority when no credible hand evidence exists. [mediapipe.readthedocs](https://mediapipe.readthedocs.io/en/latest/solutions/hands.html)

## Stage 1: hand presence gate
Run a hand detector/landmarker on the frame and collect:
- hand presence confidence,
- number of detected hands,
- landmark confidence per hand,
- handedness outputs,
- box size and landmark completeness. [huggingface](https://huggingface.co/STMicroelectronics/hand_landmarks)

Then compute a **hand evidence score**. If this score is below a threshold, classify as `no_hands`. The key is that `no_hands` should not mean “detector failed”; it should mean **there is insufficient evidence of any hand after combining all signals**. That protects you from false `no_hands` labels on occluded or dark frames. [developers.google](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker)

## Stage 2: difficulty attribution
If hands are present, decide which hard category dominates. I would use this order:

1. `low_lighting`
2. `occluded`
3. `dexterous_pose`
4. `easy`

This order matters because a low-light frame can also be occluded or dexterous, but the primary annotation challenge is often lighting first. You need a deterministic tie-break policy so the same frame always lands in one bucket. [developers.google](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker)

## How to detect each class
### `low_lighting`
Use image statistics first, model second. Compute:
- mean luminance,
- lower percentile brightness,
- contrast,
- local variance,
- histogram spread,
- and optional blur score.

Then confirm with model behavior: if brightness is poor **and** detector confidence falls, mark `low_lighting`. If brightness is fine but confidence is low, that is probably not lighting; look at occlusion or pose instead. [huggingface](https://huggingface.co/STMicroelectronics/hand_landmarks)

### `occluded`
This should be driven by **partial structure loss**, not just low confidence. A frame is likely `occluded` if:
- the detector sees a hand but landmarks are sparse or missing,
- fingertip or finger-chain landmarks disappear while palm/wrist remain,
- one model detects a hand while another does not,
- the same hand is stable in nearby frames but degrades sharply in this frame,
- the box is clipped by objects, image border, or the other hand.

Occlusion is best inferred from **structured missingness** in the landmark pattern plus temporal instability, because that is what occlusion really looks like. [mediapipe.readthedocs](https://mediapipe.readthedocs.io/en/latest/solutions/hands.html)

### `dexterous_pose`
This is the hardest class to identify and should not be defined as “low confidence.” Instead, look for:
- unusually high landmark articulation,
- strong finger spread or curl,
- self-intersection / self-overlap,
- hand-object interaction,
- unstable landmark geometry even when visibility is decent,
- detector confidence that is not terrible but pose geometry is complex.

A good mental model: if the hand is visible but its geometry is hard to annotate precisely, it is `dexterous_pose`. This is why pose complexity needs shape features, not only confidence. [mediapipe.readthedocs](https://mediapipe.readthedocs.io/en/latest/solutions/hands.html)

### `easy`
`easy` means:
- hands are present,
- lighting is normal,
- landmarks are mostly complete,
- confidence is stable,
- temporal agreement is high,
- and there is no strong evidence of occlusion or dexterous complexity.

In other words, `easy` is the residual class after the hard classes have been ruled out by stronger signals.

## The decision function
Use a score-based decision layer instead of a hard-coded heuristic tree. For each frame, build feature scores:

- `S_nohands`
- `S_lowlight`
- `S_occlusion`
- `S_dexterity`
- `S_easy`

Then choose the class with the highest score, with `no_hands` gated first.

A practical formula is:

\[
S_{lowlight} = a_1(1-\text{brightness}) + a_2(1-\text{contrast}) + a_3(1-\text{detector confidence})
\]

\[
S_{occlusion} = b_1(\text{partial landmark loss}) + b_2(\text{model disagreement}) + b_3(\text{temporal dropout}) + b_4(\text{border clipping})
\]

\[
S_{dexterity} = c_1(\text{landmark articulation}) + c_2(\text{shape complexity}) + c_3(\text{self-overlap}) + c_4(\text{jitter under good visibility})
\]

\[
S_{nohands} = d_1(1-\text{hand evidence})
\]

Then:
- if `S_nohands` exceeds threshold, return `no_hands`,
- otherwise return the argmax among the other three,
- if all are weak, return `easy` only when hand evidence is solid and none of the hard signals dominate.

## Why this works better than a single model
A single detector confidence threshold cannot separate:
- dark but easy hands,
- visible but occluded hands,
- visible but dexterous hands,
- and true no-hand frames.

Your classifier must model the **reason for annotation difficulty**, not just uncertainty. The reason comes from combining:
- hand presence,
- landmark completeness,
- brightness,
- model disagreement,
- and temporal consistency. [huggingface](https://huggingface.co/STMicroelectronics/hand_landmarks)

## What to implement first
If you want something buildable and defensible, implement this order:

1. **Frame-level hand detector/landmarker** that exposes confidence and landmarks. [developers.google](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker)
2. **Brightness/contrast/blur metrics** for the image.
3. **Temporal context window** over neighboring frames.
4. **Feature extraction** for occlusion, lighting, and dexterity.
5. **Rule-based scorer** with explainable thresholds.
6. Later, replace the scorer with a small learned classifier if you have enough verified labels.

That gives you a system you can ship quickly and still justify technically.

## The exact final policy
If I had to write the final policy in one sentence:

**Classify as `no_hands` when hand evidence is insufficient; otherwise classify the frame by the strongest dominant difficulty signal among low lighting, occlusion, and dexterous pose; if none dominate, label it `easy`.** [mediapipe.readthedocs](https://mediapipe.readthedocs.io/en/latest/solutions/hands.html)
