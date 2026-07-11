**uniform + event-driven hybrid**. That gives you broad coverage of the video while also oversampling the frames most likely to contain hands, occlusions, low light, or dexterous poses. [ar5iv.labs.arxiv](https://ar5iv.labs.arxiv.org/html/2209.13064)

## Exact policy to use
Use this as your default:

1. **Uniform base sampling** at **1 fps** over the entire clip.
2. **Event-driven burst sampling** around hand-activity intervals at **5 fps** for a short temporal window.
3. **Adaptive densification** to **10 fps** only around transitions where the detector confidence changes sharply or hand presence appears/disappears.
4. **Keep all no-hand candidates**, but assign them a lower priority unless they are useful for balance or calibration. [arxiv](https://arxiv.org/pdf/1905.00742.pdf)

This is the right compromise because egocentric video has long low-information stretches, but the annotation value is concentrated around brief interaction segments. [ar5iv.labs.arxiv](https://ar5iv.labs.arxiv.org/html/2209.13064)

## How to trigger event-driven sampling
Define an “event” when any of these happens:
- hand detector confidence rises above a threshold,
- a hand first appears after being absent,
- a hand disappears after being present,
- model disagreement spikes,
- brightness or motion changes sharply,
- landmark stability drops. [arxiv](https://arxiv.org/pdf/1905.00742.pdf)

When an event triggers, sample a window such as \(\pm 3\) to \(\pm 5\) seconds around it at the higher rate. This captures both the hard frame and its context, which is useful for triage and for annotators who need neighboring frames to understand occlusion or pose changes.

## Why this is better than pure uniform sampling
Pure uniform sampling wastes effort on repetitive no-hand frames. Pure event-driven sampling can miss long quiet periods that are important for `no_hands` balance and for measuring false positives. The hybrid policy gives you:
- coverage of the full clip,
- enough no-hand examples,
- dense capture of difficult hand segments,
- and context around transitions that often contain the hardest frames. [ar5iv.labs.arxiv](https://ar5iv.labs.arxiv.org/html/2209.13064)

## Recommended operational numbers
For your demo, I would start with:
- **1 fps baseline**,
- **5 fps around detected hand activity**,
- **2–4 second context windows** before and after each event,
- and a cap so you do not explode into too many frames per clip.

If the clip is 5 minutes:
- uniform baseline gives about **300 frames**,
- event windows add more only where hands actually matter,
- so you avoid the 9000-frame brute-force cost while still preserving quality.

## What to implement
Build the sampler as a two-pass system:
- **Pass 1:** cheap scan of the clip to estimate motion/hand presence every few frames.
- **Pass 2:** extract frames according to the hybrid policy above.

The sampler should output frame metadata like:
- `clip_id`,
- `timestamp`,
- `sample_reason` = `uniform`, `hand_event`, `confidence_drop`, `transition_window`,
- `sample_rate_used`,
- `event_id` if applicable.

That metadata will help the admin view and also let you explain why a frame was selected.

## Bottom line
Use **1 fps uniform sampling plus 5 fps event-driven bursts with short context windows**. That is the most defensible, engineering-sound sampling policy for this RFP because it matches the reality of egocentric hand activity and keeps the annotation queue high-value instead of brute-force huge. [arxiv](https://arxiv.org/pdf/1905.00742.pdf)