# Pink Trombone parameter capture studio

The Studio records Pink Trombone UI state, never microphone audio. Its data flow is:

```text
Reference mapping -> immutable parameter take -> editable phases -> draft -> saved override
```

## Parameter inventory

### Captured as phoneme input

| Source | Raw take value | Final phoneme use |
| --- | --- | --- |
| `Glottis.UIFrequency` | `glottis.ui_frequency` | Fundamental-frequency target. |
| `Glottis.UITenseness` | `glottis.ui_tenseness` | Glottal tenseness/phonation target. |
| `Glottis.intensity` | `glottis.intensity` | Source intensity. |
| `Glottis.loudness` | `glottis.loudness` | Source output gain. |
| `Glottis.isTouched` | `glottis.explicit_voice` | Diagnostic evidence of explicit voice control. |
| `Glottis.isTouchingSomewhere` | `glottis.source_active` | Activity detection; not saved directly. |
| `TractUI.tongueIndex` | `tract.tongue_index` | Vowel/approximant tongue target. |
| `TractUI.tongueDiameter` | `tract.tongue_diameter` | Vowel/approximant tongue target. |
| `Tract.targetDiameter[44]` | full tract target profile | Constriction position, diameter, and width. |
| `Tract.velumTarget` | `tract.velum_target` | Oral/nasal coupling target. |
| Manual touches | position, diameter, alive state, turbulence | Constriction and frication analysis. |
| Capture timestamps | frame times | Duration, phase boundaries, closure and frication timing. |

### Captured for diagnosis and preview

These values explain the physical response but are not copied into an override:

- `Tract.diameter[44]`: smoothed physical tract state;
- `Tract.restDiameter[44]`: tongue-derived neutral profile;
- `Tract.noseDiameter[0]`: current smoothed velum opening;
- `Tract.transients`: automatically generated release events;
- glottis vibrato amount/frequency: global engine settings;
- touch coordinates and start/end times.

Waveguide arrays (`R`, `L`, reflections, areas, outputs and amplitudes) are solver state. They are neither user intent nor stable phoneme parameters and therefore are not recorded.

`aspiration_noise`, `phonation`, metadata, support level and release strength do not have independent controls in the original Pink Trombone UI. Existing mapping values are preserved unless a phase rule derives a supported replacement.

## Capture rules by phoneme type

| Type | Automatic phase cue | Parameters built from the phase |
| --- | --- | --- |
| Vowel | Longest stable source-active range | frequency, tenseness, intensity, loudness, tongue, lips, velum; oral constrictions removed except lip rounding. |
| Nasal | Oral closure plus open velum | closure geometry, velum, source controls, duration; turbulence disabled. |
| Stop | Complete oral closure, followed by release | closure geometry and duration, oral velum, release transient, two-phase gesture. Carrier tongue/lips are preserved from the reference. |
| Fricative | Narrow non-closed constriction plus turbulence | constriction geometry, turbulence intensity, oral velum, source controls, duration. |
| Affricate | Closure followed by frication | independent closure/frication geometries, both durations, turbulence and release transition. |
| Approximant/lateral | Stable partial non-turbulent constriction | tongue, lips, partial constriction, velum and source controls. |
| Tap/trill | Brief closure or repeated closure ranges | contact geometry, short contact time and release gesture. |
| Other | Longest active UI range | best available tract/source target, editable before applying. |

Carrier vowels and operator delays remain visible in the raw timeline but are outside the automatically selected consonant phases. Robust medians are calculated only from included phase frames.

## Timeline model

The take is immutable. Editing a phase changes `phase.edits`, not its raw frames. Supported phase edits cover:

- frequency, tenseness, intensity and loudness;
- tongue index/diameter and lip diameter where relevant;
- velum target;
- constriction index, diameter and width;
- turbulence intensity;
- phase start/end and inclusion in the draft.

The timeline renders:

- a 44-position tractogram from `targetDiameter`;
- velum, turbulence and voice tracks;
- detected phase bands;
- editable phase boundaries, selection and playhead.

Scrubbing applies the corresponding raw frame back to Pink Trombone. Preview replays the selected raw parameter sequence. Building the draft converts the edited phases into compact phoneme targets.

## Saved gesture model

Dynamic consonants store compact phases instead of frame-by-frame data:

```json
{
  "gesture": {
    "version": 1,
    "duration_ms": 110,
    "phases": [
      {
        "id": "closure",
        "type": "closure",
        "start_ms": 0,
        "end_ms": 55,
        "target": { "tract": { "constrictions": [] } }
      },
      {
        "id": "frication",
        "type": "frication",
        "start_ms": 55,
        "end_ms": 110,
        "target": { "noise": { "turbulence": true, "turbulence_intensity": 0.9 } }
      }
    ]
  }
}
```

The controller executes these phases generically. Legacy `events` remain populated for compatibility.

## Implementation status

- [x] Complete UI-parameter take with diagnostic engine state.
- [x] Type-aware segmentation and carrier exclusion.
- [x] Editable tractogram/scalar timeline and scrubbing.
- [x] Per-phase parameter inspector with non-destructive edits.
- [x] Selective draft application by parameter group.
- [x] Generic gesture playback for stops, affricates and taps.
- [x] Correct tap/trill classification and plain-stop release.
- [x] Mutually exclusive Keyboard/Calibrate panels and capture state reset.
- [x] Unit and browser test coverage for capture classes and phase playback.
