// Diktat: Aufnahme im Browser, Umwandlung in Text.
// Bevorzugt Workers AI (Server, /api/ai/transcribe); ohne Server-KI die Spracherkennung des Browsers (Live-Text).
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

export type DictationState = 'idle' | 'recording' | 'transcribing' | 'error';
type Engine = 'server' | 'browser' | 'none';

interface SpeechRec {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
const SpeechCtor = (): (new () => SpeechRec) | undefined =>
  (window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec }).webkitSpeechRecognition;

let engineCache: Promise<Engine> | null = null;
/** Welche Spracherkennung steht zur Verfügung? (einmal je Seite ermittelt) */
export function dictationEngine(): Promise<Engine> {
  engineCache ??= api<{ transcribe: boolean }>('/ai/status')
    .then((s) => (s.transcribe && typeof MediaRecorder !== 'undefined' ? 'server' : SpeechCtor() ? 'browser' : 'none') as Engine)
    .catch(() => (SpeechCtor() ? 'browser' : 'none') as Engine);
  return engineCache;
}

function pickMime() {
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) if (MediaRecorder.isTypeSupported?.(m)) return m;
  return '';
}

/**
 * Diktat-Hook. `onText` bekommt den fertigen Text (Server) bzw. laufend den bisher erkannten Text (Browser, `final=false`).
 */
export function useDictation(onText: (text: string, final: boolean) => void) {
  const [state, setState] = useState<DictationState>('idle');
  const [engine, setEngine] = useState<Engine | null>(null);
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const cb = useRef(onText);
  cb.current = onText;
  const stopRef = useRef<() => void>(() => {});

  useEffect(() => {
    let alive = true;
    dictationEngine().then((e) => alive && setEngine(e));
    return () => {
      alive = false;
      stopRef.current();
    };
  }, []);

  const start = useCallback(async () => {
    setError('');
    const eng = await dictationEngine();
    if (eng === 'none') {
      setError('Diktat wird von diesem Browser nicht unterstützt');
      setState('error');
      return;
    }
    const t0 = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - t0) / 1000)), 250);
    setSeconds(0);
    if (eng === 'browser') {
      const Rec = SpeechCtor()!;
      const rec = new Rec();
      rec.lang = 'de-DE';
      rec.continuous = true;
      rec.interimResults = true;
      let finalText = '';
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += `${r[0].transcript.trim()}. `;
          else interim += r[0].transcript;
        }
        cb.current(`${finalText}${interim}`.trim(), false);
      };
      rec.onerror = (e) => {
        if (e.error !== 'aborted' && e.error !== 'no-speech') setError(e.error === 'not-allowed' ? 'Mikrofon nicht freigegeben' : 'Spracherkennung fehlgeschlagen');
      };
      rec.onend = () => {
        clearInterval(timer);
        cb.current(finalText.trim(), true);
        setState('idle');
      };
      stopRef.current = () => rec.stop();
      rec.start();
      setState('recording');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      clearInterval(timer);
      setError('Mikrofon nicht freigegeben');
      setState('error');
      return;
    }
    const mime = pickMime();
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    // Pegel für die Anzeige
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      setLevel(Math.min(1, peak / 64));
      raf = requestAnimationFrame(tick);
    };
    tick();
    recorder.onstop = async () => {
      clearInterval(timer);
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
      setLevel(0);
      const blob = new Blob(chunks, { type: (recorder.mimeType || 'audio/webm').split(';')[0] });
      if (blob.size < 1200) {
        setState('idle');
        return;
      }
      setState('transcribing');
      try {
        const r = await api<{ text: string }>('/ai/transcribe', { raw: blob, type: blob.type, method: 'POST' });
        cb.current(r.text, true);
        setState('idle');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Umwandlung fehlgeschlagen');
        setState('error');
      }
    };
    stopRef.current = () => recorder.state === 'recording' && recorder.stop();
    recorder.start(1000);
    setState('recording');
    // Sicherheitsgrenze: nach 5 Minuten automatisch beenden
    setTimeout(() => stopRef.current(), 5 * 60_000);
  }, []);

  const stop = useCallback(() => stopRef.current(), []);
  return { state, engine, level, seconds, error, start, stop, supported: engine !== 'none' };
}

export const fmtSeconds = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
