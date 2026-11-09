"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import "./startup-splash.css";

const seenKey = "gm-manager-startup-splash-v1";
const whitePoster = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='9'%3E%3Cpath fill='white' d='M0 0h16v9H0z'/%3E%3C/svg%3E";
type Mode = "idle" | "video" | "still";

function shouldPlaySplash() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  try {
    if (window.sessionStorage.getItem(seenKey)) return false;
    window.sessionStorage.setItem(seenKey, "seen");
  } catch { /* The splash can still play when session storage is disabled. */ }
  return true;
}

export default function StartupSplash({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>("idle");
  const [revealing, setRevealing] = useState(false);
  const checked = useRef(false);
  const playing = useRef(false);
  const video = useRef<HTMLVideoElement>(null);
  const active = mode !== "idle";

  useLayoutEffect(() => {
    if (checked.current) return;
    checked.current = true;
    if (shouldPlaySplash()) setMode("video");
  }, []);

  useEffect(() => {
    if (mode === "idle") return;
    if (revealing || mode === "still") {
      const timer = window.setTimeout(() => {
        if (revealing) setMode("idle");
        else setRevealing(true);
      }, revealing ? 450 : 300);
      return () => window.clearTimeout(timer);
    }
    const startTimeout = window.setTimeout(() => {
      if (!playing.current) setMode("still");
    }, 1200);
    const endTimeout = window.setTimeout(() => setRevealing(true), 3500);
    void video.current?.play().catch(() => { /* Autoplay restrictions use the timed fallback. */ });
    return () => {
      window.clearTimeout(startTimeout);
      window.clearTimeout(endTimeout);
    };
  }, [mode, revealing]);

  return <>
    <div className="startup-splash__workspace" inert={active}>{children}</div>
    {active && <div className={`startup-splash${revealing ? " startup-splash--revealing" : ""}`} role="status" aria-label="Đang mở GM Manager"
      onAnimationEnd={(event) => { if (event.target === event.currentTarget && revealing) setMode("idle"); }}>
      {mode === "video" ? <video ref={video} className="startup-splash__video" src={`${import.meta.env.BASE_URL}gm-logo-startup.mp4`}
        poster={whitePoster} autoPlay muted playsInline preload="auto" aria-hidden="true"
        onPlaying={() => { playing.current = true; }}
        onEnded={() => setRevealing(true)}
        onError={() => { if (!revealing) setMode("still"); }} />
        : <img className="startup-splash__still" src={`${import.meta.env.BASE_URL}gm-logo-192.png`} alt="" />}
    </div>}
  </>;
}
