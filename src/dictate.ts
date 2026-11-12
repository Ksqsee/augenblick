// Diktat: Spracherkennung des Browsers (Live-Text, kostenlos, keine Server-KI).
// Ohne Unterstützung im Browser gibt es keinen Mikrofon-Knopf – Tippen geht immer.
import { useCallback, useEffect, useRef, useState } from 'react';

/** `transcribing` bleibt Teil der API (Anzeigen prüfen darauf), kommt mit der Browser-Erkennung aber nicht vor. */
export type DictationState = 'idle' | 'recording' | 'transcribing' | 'error';
type Engine = 'browser' | 'none';

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

/** Welche Spracherkennung steht zur Verfügung? */
export function dictationEngine(): Promise<Engine> {
  return Promise.resolve(typeof window !== 'undefined' && SpeechCtor() ? 'browser' : 'none');
}

/**
 * Diktat-Hook. `onText` bekommt laufend den bisher erkannten Text (`final=false`) und am Ende den fertigen Text (`final=true`).
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
    const Rec = SpeechCtor();
    if (!Rec) {
      setError('Diktat wird von diesem Browser nicht unterstützt');
      setState('error');
      return;
    }
    const t0 = Date.now();
    setSeconds(0);
    // Pegelanzeige: bei erkanntem Text kurz ausschlagen, dann abklingen (ohne zweiten Mikrofonzugriff)
    let pulse = 0;
    const timer = setInterval(() => {
      setSeconds(Math.floor((Date.now() - t0) / 1000));
      pulse = Math.max(0, pulse - 0.15);
      setLevel(pulse);
    }, 120);
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
      pulse = 0.5 + Math.random() * 0.5;
      cb.current(`${finalText}${interim}`.trim(), false);
    };
    rec.onerror = (e) => {
      if (e.error !== 'aborted' && e.error !== 'no-speech') setError(e.error === 'not-allowed' ? 'Mikrofon nicht freigegeben' : 'Spracherkennung fehlgeschlagen');
    };
    rec.onend = () => {
      clearInterval(timer);
      setLevel(0);
      cb.current(finalText.trim(), true);
      setState('idle');
    };
    stopRef.current = () => rec.stop();
    try {
      rec.start();
    } catch {
      clearInterval(timer);
      setError('Spracherkennung fehlgeschlagen');
      setState('error');
      return;
    }
    setState('recording');
    // Sicherheitsgrenze: nach 5 Minuten automatisch beenden
    setTimeout(() => stopRef.current(), 5 * 60_000);
  }, []);

  const stop = useCallback(() => stopRef.current(), []);
  return { state, engine, level, seconds, error, start, stop, supported: engine !== 'none' };
}

export const fmtSeconds = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
