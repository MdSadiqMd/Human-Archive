First, **separate model failure into error types**, then fix the part that is actually broken: detection thresholding, input normalization, temporal logic, or model choice. [developers.google](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker)

## What to do first
Run a failure audit on a few hundred frames and split outputs into these buckets:
- **missed hand**,
- **wrong box / wrong landmarks**,
- **bad handedness**,
- **jitter across adjacent frames**,
- **low-light failures**,
- **occlusion failures**,
- **dexterous-pose failures**.

This tells you whether the model is weak globally or whether your pipeline is misconfigured. MediaPipe-style hand landmarkers expose separate knobs for detection, presence, and tracking confidence, so a lot of “bad output” is actually a thresholding or mode-selection problem, not a model problem. [ai.google](https://ai.google.dev/edge/api/mediapipe/js/tasks-vision.handlandmarkeroptions)

## Fix the inference mode
If you are processing isolated frames, use **image/static mode**. If you are processing a video sequence, use **video mode** so the tracker can reuse spatial continuity and avoid re-detecting on every frame. A common mistake is running a temporal model as if every frame were independent, which kills stability and makes outputs look worse than they are. [medium](https://medium.com/@kyang3200/deeplearning-hands-tracking-by-mediapipe-b91b5bf252e8)

## Tune the three confidence gates
For MediaPipe-like hand models, tune these separately:
- `min_hand_detection_confidence`
- `min_hand_presence_confidence`
- `min_tracking_confidence` [developers.google](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker)

The defaults are around `0.5`, but that is just a starting point. If you care about recall, lower detection confidence slightly and rely on downstream filtering; if you care about precision, raise it and accept some misses. For egocentric hands, I would usually start with a small grid search over these thresholds and evaluate on a hand-picked validation set with the actual failure modes you care about. [ai.google](https://ai.google.dev/edge/api/mediapipe/js/tasks-vision.handlandmarkeroptions)

## Do not trust a single model output
If the model outputs are not great, the next move is **model ensembling by disagreement**, not just picking another checkpoint. Run:
- one landmark model,
- one box detector,
- one cheap image-quality scorer,

then compare where they disagree. The disagreement frames are often the hard ones, and the agreement frames are usually safe. This is exactly what you need for your hard-frame triage pipeline. [mediapipe.readthedocs](https://mediapipe.readthedocs.io/en/latest/solutions/hands.html)

## Normalize the input carefully
A lot of bad CV output in egocentric video comes from avoidable preprocessing issues:
- wrong color order,
- too much resize distortion,
- compressed input artifacts,
- inconsistent aspect ratio handling,
- and poor exposure.

Check that your preprocessing preserves the hand region. If you are downscaling, keep enough detail for fingertips and finger articulation. If you are cropping, don’t crop away the wrists, because wrist continuity is one of the strongest stability cues in hand tracking.

## Use temporal smoothing only where it helps
If the output jitters, don’t immediately switch models. First apply **tracking-aware smoothing** or a short temporal filter on landmarks and boxes. MediaPipe-based systems already use tracking confidence to decide whether to redetect or continue tracking. If you are seeing flicker, that often means your tracking gate is too aggressive or too lax. [developers.google](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker)

## Build a hard-frame validation set
You need a tiny but very specific validation set:
- low light,
- occluded hands,
- dexterous poses,
- no hands,
- clean easy frames.

Then measure the model on those slices, not on a generic average. Average metrics will lie to you here, because the project is about surfacing difficult frames, not winning a leaderboard. This slice-based evaluation tells you whether you should:
- change thresholds,
- switch models,
- add temporal context,
- or accept that the model is only a weak signal and move more logic into the scorer.

## If results are still bad
Then the answer is probably not “tune more.” It is one of these:
- the model was trained on the wrong domain,
- the egocentric perspective is too different,
- the hands are too small in frame,
- motion blur is too severe,
- or the model lacks explicit occlusion reasoning.

At that point, I would stop optimizing the detector and instead use it as a **proposal generator** for your difficulty classifier. For this RFP, that is often the right trade: the model does not need to be perfect; it needs to be informative.

## Recommended next move
Do this in order:
1. Freeze preprocessing.
2. Run the model in the correct mode.
3. Sweep confidence thresholds.
4. Evaluate on a hand-curated hard-frame set.
5. Add a second model for disagreement.
6. Use the model outputs as signals for your frame-ranking system, not as final truth.
