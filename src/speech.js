export class SpeechCoach {
  constructor({ lang = "en-GB", onUpdate = () => {}, onState = () => {}, onError = () => {} } = {}) {
    this.lang = lang;
    this.onUpdate = onUpdate;
    this.onState = onState;
    this.onError = onError;
    this.recognition = null;
    this.keepListening = false;
    this.finalTranscript = "";
    this.interimTranscript = "";
    this.confidences = [];
    this.startedAt = 0;
    this.lastSpeechAt = 0;
    this.pauseCount = 0;
    this.restarts = 0;
    this.stopTimer = null;
  }

  static isRecognitionSupported() {
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  createRecognition() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return null;
    const recognition = new Recognition();
    recognition.lang = this.lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      let interim = "";
      const now = Date.now();
      if (this.lastSpeechAt && now - this.lastSpeechAt > 1900) this.pauseCount += 1;
      this.lastSpeechAt = now;
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0].transcript;
        if (result.isFinal) {
          this.finalTranscript += `${transcript.trim()} `;
          if (Number.isFinite(result[0].confidence) && result[0].confidence > 0) this.confidences.push(result[0].confidence);
        } else {
          interim += transcript;
        }
      }
      this.interimTranscript = interim;
      this.onUpdate(this.snapshot());
    };
    recognition.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") this.keepListening = false;
      this.onError(event.error);
    };
    recognition.onend = () => {
      if (this.keepListening) {
        this.restarts += 1;
        window.setTimeout(() => {
          if (!this.keepListening) return;
          try { recognition.start(); } catch { /* browser is already restarting */ }
        }, 160);
      } else {
        this.onState("idle");
        this.onUpdate(this.snapshot());
      }
    };
    return recognition;
  }

  start({ initialText = "", maxSeconds = 0 } = {}) {
    if (!SpeechCoach.isRecognitionSupported()) {
      this.onError("unsupported");
      return false;
    }
    window.speechSynthesis?.cancel();
    this.finalTranscript = initialText ? `${initialText.trim()} ` : "";
    this.interimTranscript = "";
    this.confidences = [];
    this.pauseCount = 0;
    this.restarts = 0;
    this.startedAt = Date.now();
    this.lastSpeechAt = 0;
    this.keepListening = true;
    this.recognition = this.createRecognition();
    try {
      this.recognition.start();
      this.onState("listening");
      if (maxSeconds > 0) this.stopTimer = window.setTimeout(() => this.stop(), maxSeconds * 1000);
      return true;
    } catch (error) {
      this.keepListening = false;
      this.onError(error.message);
      return false;
    }
  }

  stop() {
    this.keepListening = false;
    window.clearTimeout(this.stopTimer);
    this.stopTimer = null;
    try { this.recognition?.stop(); } catch { /* already stopped */ }
    this.onState("idle");
    return this.snapshot();
  }

  reset() {
    this.stop();
    this.finalTranscript = "";
    this.interimTranscript = "";
    this.confidences = [];
    this.startedAt = 0;
    this.pauseCount = 0;
  }

  snapshot() {
    const confidence = this.confidences.length
      ? this.confidences.reduce((sum, value) => sum + value, 0) / this.confidences.length
      : null;
    return {
      transcript: `${this.finalTranscript}${this.interimTranscript}`.trim(),
      finalTranscript: this.finalTranscript.trim(),
      confidence,
      durationSeconds: this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0,
      pauseCount: this.pauseCount,
      restarts: this.restarts,
    };
  }
}

export function speak(text, { lang = "en-GB", rate = 0.96, enabled = true } = {}) {
  if (!enabled || !window.speechSynthesis || !text) return Promise.resolve();
  window.speechSynthesis.cancel();
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text.replace(/<[^>]+>/g, ""));
    utterance.lang = lang;
    utterance.rate = rate;
    utterance.pitch = 1;
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find((voice) => voice.lang === lang && /female|susan|serena|libby|sonia/i.test(voice.name))
      || voices.find((voice) => voice.lang === lang)
      || voices.find((voice) => voice.lang.startsWith("en"));
    if (preferred) utterance.voice = preferred;
    utterance.onend = resolve;
    utterance.onerror = resolve;
    window.speechSynthesis.speak(utterance);
  });
}

export function stopSpeaking() {
  window.speechSynthesis?.cancel();
}
