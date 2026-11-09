"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import "./startup-splash.css";

const seenKey = "gm-manager-startup-splash-v1";
const whitePoster = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='9'%3E%3Cpath fill='white' d='M0 0h16v9H0z'/%3E%3C/svg%3E";
type Mode = "idle" | "video" | "revealing";

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
    if (mode === "revealing") {
      const timer = window.setTimeout(() => setMode("idle"), 450);
      return () => window.clearTimeout(timer);
    }
    const startTimeout = window.setTimeout(() => {
      if (!playing.current) setMode("idle");
    }, 1200);
    const endTimeout = window.setTimeout(() => {
      setMode((current) => current === "video" ? "revealing" : current);
    }, 3500);
    void video.current?.play().catch(() => { /* The start timeout handles blocked autoplay. */ });
    return () => {
      window.clearTimeout(startTimeout);
      window.clearTimeout(endTimeout);
    };
  }, [mode]);

  return <>
    <div className="startup-splash__workspace" inert={active}>{children}</div>
    {active && <div className={`startup-splash${mode === "revealing" ? " startup-splash--revealing" : ""}`} role="status" aria-label="Đang mở GM Manager"
      onAnimationEnd={(event) => { if (event.target === event.currentTarget && mode === "revealing") setMode("idle"); }}>
      <video ref={video} className="startup-splash__video" src={`${import.meta.env.BASE_URL}gm-logo-startup.mp4`}
        poster={whitePoster} autoPlay muted playsInline preload="auto" aria-hidden="true"
        onPlaying={() => { playing.current = true; }}
        onEnded={() => setMode("revealing")}
        onError={() => setMode("idle")} />
    </div>}
  </>;
}
