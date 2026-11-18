import { useCallback, useEffect, useRef, useState } from "react";

type Recognition = InstanceType<NonNullable<Window["SpeechRecognition"]>>;
export function useVoiceEdit(enabled: boolean, onResult: (text: string) => void) {
  const recognitionRef = useRef<Recognition | null>(null);
  const resultRef = useRef(onResult);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const supported = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  useEffect(() => { resultRef.current = onResult; }, [onResult]);
  const abort = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onresult = null; recognition.onerror = null; recognition.onend = null;
      try { recognition.abort(); } catch { /* A stopped recognizer needs no further cleanup. */ }
    }
  }, []);
  useEffect(() => {
    if (!enabled) { abort(); setListening(false); }
    return abort;
  }, [enabled, abort]);
  const toggle = () => {
    if (!enabled) return;
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { abort(); setListening(false); }
      return;
    }
    const API = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!API) { setError("Speech input is unavailable in this browser. Type your edit instead."); return; }
    const recognition = new API();
    recognitionRef.current = recognition;
    recognition.continuous = false; recognition.interimResults = false;
    recognition.lang = navigator.language || "en";
    recognition.onresult = event => {
      if (recognitionRef.current !== recognition) return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          const text = event.results[i][0].transcript.trim();
          if (text) resultRef.current(text);
        }
      }
    };
    recognition.onerror = event => {
      if (recognitionRef.current !== recognition) return;
      setError(event.error === "not-allowed" || event.error === "service-not-allowed" ? "Microphone access was not allowed. Type your edit or try again."
        : event.error === "no-speech" ? "No speech detected. Try again." : "Speech input could not finish. Type your edit or try again.");
      abort(); setListening(false);
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) { recognitionRef.current = null; setListening(false); }
    };
    setError(""); setListening(true);
    try { recognition.start(); }
    catch { abort(); setListening(false); setError("Speech input could not start. Try again."); }
  };
  return { supported, listening, error, toggle };
}
