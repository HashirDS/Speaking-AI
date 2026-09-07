# Luma IELTS Speaking Coach

Luma is a zero-cost IELTS Speaking practice app that runs entirely in the browser. It talks like an examiner, listens to spoken answers, creates transcript-based feedback against the four public IELTS Speaking criteria, stores progress locally, and adapts a 30-day plan from foundation to full mock tests.

No account, paid AI API, cloud database, or backend is required.

## Run it locally

Requirements: Node.js 18 or newer and a recent desktop version of Chrome or Edge for the best speech-recognition support.

```bash
npm run dev
```

Open `http://127.0.0.1:4173`. Allow microphone access when the first speaking answer begins.

If port 4173 is already being used, the launcher automatically tries 4174, 4175, and so on. Open the exact address printed in the terminal.

The application itself has no npm dependencies. You can also serve the folder with any static HTTP server. Opening `index.html` directly as a `file://` URL is not recommended because browser microphone and module security rules may block features.

## Included

- Part 1 familiar-topic interviews with adaptive follow-ups
- Part 2 cue cards with a 60-second preparation timer, notes, and 2-minute cap
- Connected Part 3 abstract discussions
- Continuous full mock and shorter diagnostic modes
- Four-criterion practice estimates with a visible uncertainty range: fluency/coherence, lexical resource, grammar range/accuracy, and pronunciation
- 30-day basic-to-advanced route with focused checkpoints
- 16 Part 1 sets and 18 cue-card sets, each linked to Part 3 questions
- IndexedDB progress, session history, local transcripts, export, and reset
- Typed fallback when browser speech recognition is unavailable
- Free Talk room with Daily Conversation and IELTS Coach modes using local adaptive replies and browser voice
- Responsive desktop/mobile UI and static Vercel configuration

The Talk room is intentionally browser-only: it uses Web Speech recognition and speech synthesis, then selects contextual follow-ups locally. It does not call a generative AI model or require an API key. A true open-ended LLM assistant would require either a large model downloaded to the browser or a cloud provider key, along with the associated device, privacy and usage trade-offs.

## Accuracy and scoring boundary

The app follows the official public format and criteria, but it does not claim to issue an official band. Certified IELTS examiners assess a complete live performance. Luma uses observable transcript and timing evidence: answer length, pace, disruptive fillers, cohesion signals, vocabulary diversity, structural variety, selected error patterns, and browser recognition confidence.

Pronunciation is the strictest limitation. Browser recognition can provide a rough intelligibility signal, but it cannot reliably judge every sound, word stress, connected speech, rhythm, or intonation. Provisional pronunciation is therefore capped at 7.5. If the browser supplies no recognition confidence, pronunciation and the overall band are left unscored rather than guessed. Typed answers receive neither fluency nor pronunciation scores and never produce an overall speaking band. The UI repeats these boundaries wherever a result appears.

Scoring version 2 also distinguishes real hesitation markers from ordinary content uses (for example, "I like music" is not a filler), ignores browser-service restarts, applies response-length evidence ceilings, equally weights the four criteria, and shows a likely band range. Existing locally stored version 1 attempts are recalculated automatically; ambiguous legacy pronunciation confidence is discarded.

The question bank contains original IELTS-style material. It does not copy commercial cue-card collections, promise leaked questions, or encourage memorised model answers.

Official public references used for design:

- [IELTS Academic test format in detail](https://ielts.org/organisations/ielts-for-organisations/test-types/ielts-academic-test/academic-test-format-in-detail)
- [IELTS Speaking band descriptors — public version](https://assets.cambridgeenglish.org/webinars/ielts-speaking-band-descriptors.pdf)
- [IELTS Speaking sample tasks](https://ielts.org/cdn/Sample-tests/ielts-speaking-sample-tasks-2023.pdf)

## Test

```bash
npm test
npm run check
npm run calibrate
```

If npm is not available, the same checks can be run directly:

```bash
node --test
node --check src/app.js
```

## Deploy free on Vercel

Import this folder/repository in Vercel and select **Other** as the framework preset. No build command and no environment variables are needed. The included `vercel.json` applies static security and microphone headers.

Important: browser speech recognition support varies. HTTPS is required after deployment, which Vercel supplies automatically. Recognition in Chrome/Edge may use the browser vendor’s speech service; the app itself sends nothing to a Luma server. IndexedDB progress remains specific to that browser and device unless the learner exports it.

## Project structure

```text
index.html              Static application entry
styles.css              Responsive visual system
src/app.js              UI, session state, mock flow, adaptation
src/data.js             Topic bank, 30-day plan, official-source manifest
src/db.js               IndexedDB persistence
src/scoring.js          Explainable practice-estimate engine
src/speech.js           Recognition and examiner speech
tests/                  Data and scoring checks
server.mjs              Dependency-free local server
vercel.json             Static deployment configuration
```
