# pink-trombone

Pink Trombone exhibit by [Neil Thapen](http://venuspatrol.nfshost.com/).
Bare-handed procedural speech synthesis.
[Original version](https://dood.al/pinktrombone/)

## IPA Playback And Calibration Fork

This fork keeps the original mouse/touch Pink Trombone interaction as the base surface and adds an IPA studio made of floating tools.

Studio layers:

- **Manual surface**: when no tools are open, Pink Trombone behaves like the original direct-control instrument.
- **Playback**: a floating composer for IPA input, transport controls, warnings, and timeline.
- **Phoneme Keyboard**: a detached popup grouped by vowels, stops, fricatives, nasals, affricates, approximants, taps, and other symbols.
- **Calibrate**: a floating editor for one loaded phoneme and one editable Draft.

The global **Config Set** selector chooses whether playback and the keyboard use the base mapping or saved local overrides. If a phoneme is loaded in Calibrate, Playback also uses that unsaved Draft for the loaded phoneme.

This is not text-to-speech. It expects phonetic/IPA input. The IPA mapping is approximate, and Pink Trombone cannot perfectly represent every IPA contrast. Unsupported or unknown symbols are reported as warnings and skipped instead of crashing playback.

## Running Locally

Run the app from a local web server so the browser can load files from `data/`:

```sh
python -m http.server 8000
```

Then open `http://localhost:8000/`.

The base mapping is loaded from:

```text
data/ipa_to_pink_trombone_full.json
```

The default override file is:

```text
data/ipa_user_overrides.json
```

At runtime the app loads the base mapping, then merges override data from `data/ipa_user_overrides.json`, then merges any browser `localStorage` edits on top.

## Phonetic Input Examples

Whitespace can separate phonemes, but it is not required when the symbols are unambiguous:

```text
a i u
m a m a
mama
pata
sasa
t\u0361\u0283a
t\u0283a
d\u0361\u0292u
\u0272a
```

The tokenizer uses greedy longest-match lookup against the mapping and supports tied and untied affricates such as `t\u0361\u0283`, `d\u0361\u0292`, `t\u0283`, `d\u0292`, `ts`, and `dz`. IPA diacritics such as nasalization, aspiration, length, stress, palatalization, and labialization are applied as parameter patches when present in the mapping file.

## Playback

Playback controls:

- **Play** schedules the tokenized phoneme events.
- **Stop** clears playback and returns the tract toward rest.
- **Loop** repeats the generated event timeline.
- **Duration** scales phoneme durations. The old `2x` timing is now presented as `1x natural`; slower options go up to `4x study`.
- **Pitch** scales the mapping's glottis frequency around 140 Hz.
- **Intensity** scales glottis intensity/loudness.
- **Auto voice** lets playback turn the glottis on for voiced phonemes.
- **Keyboard** opens the detached phoneme keyboard.

The warning panel lists unknown symbols or unattached diacritics. The timeline shows each scheduled token with start time and duration.

## Phoneme Keyboard

The keyboard is not a list. It is grouped by phoneme type. Vowels are shown separately from consonants, and consonant previews use an auxiliary vowel context such as `a _ a`, `i _ i`, or `u _ u`. For example, previewing `t\u0361\u0283` with the `a _ a` context plays `at\u0361\u0283a`.

Each key can:

- **Play** a short preview.
- **Insert** the IPA token into the Playback composer.
- **Load** the phoneme into Calibrate as the current editable Draft.

## Calibrate

Calibrate is organized around one selected phoneme and one editable Draft. The Draft can start from the active Config Set, manual form edits, or an applied capture draft.

Useful controls:

- **Preview draft** plays the editable Draft.
- **Compare base** plays the original base phoneme as a reference.
- **Revert draft** reloads the Draft from the active Config Set.
- **Save draft** writes the Draft into Saved overrides.
- A canvas overlay showing base, saved override, draft, and latest recording target.
- Template-aware section chips such as glottis, tongue, velum, closure, turbulence, timing, and release.
- Sliders and numeric fields for glottis, tract, constriction, noise, release, and timing parameters.
- A diff panel showing exactly what differs from the base mapping.
- A saved custom phoneme accumulator with load, preview, import, and export controls.

## Recording Into The Draft

Recording turns manual Pink Trombone interaction into a temporary capture draft inside Calibrate.

Capture behavior differs by phoneme type:

- **Vowels** capture a stable tongue/lip/glottis/velum posture and usually remove constrictions.
- **Nasals** capture an oral closure plus an open velum.
- **Stops** capture a closure, keep release transient controls, and preview in vowel context.
- **Fricatives** capture a narrow constriction and turbulence intensity.
- **Affricates** support closure-stage and frication-stage capture.
- **Approximants** capture posture plus partial constriction.
- **Taps/trills** are marked as approximate short-contact events.

Use **Start capture** while manipulating the original Pink Trombone canvas, then **Stop** or **Use current posture**. The captured parameters are not saved and do not alter the phoneme until you choose **Apply capture to draft** or apply one section. You can also discard the capture draft.

## Override Saving

Saving writes only changed phoneme fields to browser `localStorage`. Export downloads an override file named `ipa_user_overrides.json`; the base mapping is never modified. Browsers that support the File System Access API also show a direct save button.

Override shape:

```json
{
  "version": 1,
  "updated_at": "2026-06-18T00:00:00.000Z",
  "overrides": {
    "a": {
      "duration_ms": 220,
      "tract": {
        "tongue_index": 14.5,
        "tongue_diameter": 3.2,
        "lip_diameter": 1.6
      }
    }
  }
}
```

## Tests

A small browser/Node test harness covers tokenization, longest-match selection, diacritics, merge behavior, unknown-token reporting, event scheduling, phoneme classification, calibration section patches, and captured constriction detection.

Browser:

```text
http://localhost:8000/tests.html
```

Node:

```sh
node -e "require('./src/phonetics/MappingLoader.js'); require('./src/phonetics/IPATokenizer.js'); require('./src/phonetics/PhonemeClassifier.js'); require('./src/phonetics/ParameterDiff.js'); require('./src/phonetics/ParameterCapture.js'); require('./src/phonetics/PhonemeScheduler.js'); require('./src/phonetics/tests.js'); globalThis.Phonetics.runPhoneticsTests().then(r => { console.log(r); if (r.some(x => !x.ok)) process.exit(1); });"
```

## Bibliography Provided By Original Author

Julius O. Smith III, "Physical audio signal processing for virtual musical instruments and audio effects."
https://ccrma.stanford.edu/~jos/pasp/

Story, Brad H. "A parametric model of the vocal tract area function for vowel and consonant simulation."
The Journal of the Acoustical Society of America 117.5 (2005): 3231-3254.

Lu, Hui-Ling, and J. O. Smith. "Glottal source modeling for singing voice synthesis."
Proceedings of the 2000 International Computer Music Conference. 2000.

Mullen, Jack. Physical modelling of the vocal tract with the 2D digital waveguide mesh.
PhD thesis, University of York, 2006.

## License

Copyright 2017 Neil Thapen

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the "Software"),
to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense,
and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
