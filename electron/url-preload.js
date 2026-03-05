'use strict';
// url-preload.js — injected into the urlWindow (YouTube / web player).
// Captures audio from <video> elements via Web Audio API and streams raw
// Float32 PCM to the main process over IPC so Echo2Text can transcribe it.

const { ipcRenderer } = require('electron');

const SAMPLE_RATE    = 16000;
const BUFFER_SIZE    = 4096;
const VAD_THRESHOLD  = 0.003;  // RMS below which the frame is treated as silence

let audioCtx = null;
const captured = new WeakSet();  // prevents double-capturing the same element

function captureVideoElement(video) {
  if (captured.has(video)) return;
  captured.add(video);
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
    }
    const src       = audioCtx.createMediaElementSource(video);
    const processor = audioCtx.createScriptProcessor(BUFFER_SIZE, 1, 1);

    processor.onaudioprocess = (evt) => {
      const data = evt.inputBuffer.getChannelData(0);
      // Basic VAD — skip silent frames to avoid filling the ASR buffer with silence
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      if (Math.sqrt(sum / data.length) < VAD_THRESHOLD) return;
      ipcRenderer.send('url-audio-pcm', data.buffer.slice(0));
    };

    // src → processor (capture) and src → destination (keep audio playing)
    src.connect(processor);
    src.connect(audioCtx.destination);
    processor.connect(audioCtx.destination);

    console.log('[echo2text] Audio capture started for <video> element');
  } catch (err) {
    console.warn('[echo2text] Could not capture <video> audio:', err.message);
  }
}

function scanPage() {
  document.querySelectorAll('video').forEach(captureVideoElement);
}

// Watch for dynamically-created video elements (YouTube SPA)
const observer = new MutationObserver(scanPage);

function init() {
  scanPage();
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree:   true,
  });
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
