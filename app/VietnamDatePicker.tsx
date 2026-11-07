"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formatDateInput, parseWorkflowDate, vietnamDayNumber } from "./workflow-client";

type VietnamDatePickerProps = {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  minDate?: string;
  maxDate?: string;
  disabled?: boolean;
  placeholder?: string;
  "aria-label"?: string;
};

const millisecondsPerDay = 86_400_000;
const weekdays = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

function dateText(date: Date) {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

export default function VietnamDatePicker({ value, onChange, label, minDate, maxDate, disabled, placeholder = "dd/mm/yyyy", "aria-label": ariaLabel }: VietnamDatePickerProps) {
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const gesture = useRef<{ x: number; y: number } | null>(null);
  const lastSwipe = useRef(0);
  const [month, setMonth] = useState<Date | null>(null);
  const today = vietnamDayNumber();
  const selected = parseWorkflowDate(value);
  const minimum = parseWorkflowDate(minDate ?? "");
  const maximum = parseWorkflowDate(maxDate ?? "");

  function open() {
    const initialDay = selected ?? Math.min(maximum ?? today, Math.max(minimum ?? today, today));
    const initial = new Date(initialDay * millisecondsPerDay);
    setMonth(new Date(Date.UTC(initial.getUTCFullYear(), initial.getUTCMonth(), 1)));
  }

  function moveMonth(offset: number) {
    setMonth((current) => {
      if (!current) return null;
      const next = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + offset, 1));
      return next.getUTCFullYear() >= 1000 && next.getUTCFullYear() <= 9999 ? next : current;
    });
  }

  const openCalendar = Boolean(month && !disabled);
  useEffect(() => {
    if (!openCalendar) return;
    const dismiss = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setMonth(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [openCalendar]);

  const year = month?.getUTCFullYear() ?? 0;
  const monthIndex = month?.getUTCMonth() ?? 0;
  const leading = month ? (month.getUTCDay() + 6) % 7 : 0;
  const monthDays = month ? new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate() : 0;

  return <div ref={container} className="vietnam-date-picker" onKeyDown={(event) => {
    if (event.key !== "Escape" || !openCalendar) return;
    event.preventDefault();
    event.stopPropagation();
    setMonth(null);
    trigger.current?.focus();
  }}>
    {label && <label htmlFor={id}>{label}</label>}
    <div className="vietnam-date-picker__input">
      <input id={id} aria-label={ariaLabel ?? (label ? undefined : "Ngày")} inputMode="numeric" value={value} maxLength={10} placeholder={placeholder} autoComplete="off" readOnly={disabled} onChange={(event) => {
        const next = formatDateInput(event.target.value);
        onChange(next);
        const parsed = parseWorkflowDate(next);
        if (openCalendar && parsed !== null) {
          const date = new Date(parsed * millisecondsPerDay);
          setMonth(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)));
        }
      }} onKeyDown={(event) => {
        if (event.key === "ArrowDown" && !openCalendar && !disabled) {
          event.preventDefault();
          open();
        }
      }} />
      {!disabled && <button type="button" ref={trigger} className="vietnam-date-picker__trigger" aria-label={`Mở lịch ${label ?? ariaLabel ?? "chọn ngày"}`} aria-expanded={openCalendar} aria-controls={openCalendar ? `${id}-calendar` : undefined} onClick={() => openCalendar ? setMonth(null) : open()}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 2v4M16 2v4M3 10h18M3 5h18v17H3Z" /></svg>
      </button>}
    </div>
    {openCalendar && <div className="vietnam-date-picker__calendar" id={`${id}-calendar`} role="group" aria-label="Lịch chọn ngày" onTouchStart={(event) => {
      const touch = event.touches[0];
      gesture.current = event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null;
    }} onTouchCancel={() => { gesture.current = null; }} onTouchEnd={(event) => {
      const start = gesture.current;
      gesture.current = null;
      const touch = event.changedTouches[0];
      if (!start || !touch) return;
      const distance = touch.clientX - start.x;
      if (Math.abs(distance) < 36 || Math.abs(distance) <= Math.abs(touch.clientY - start.y) * 1.5) return;
      lastSwipe.current = Date.now();
      moveMonth(distance < 0 ? 1 : -1);
    }} onClickCapture={(event) => {
      if (Date.now() - lastSwipe.current < 300 && event.detail > 0) {
        event.preventDefault();
        event.stopPropagation();
      }
    }}>
      <div className="vietnam-date-picker__heading">
        <button type="button" aria-label="Tháng trước" disabled={year <= 1000 && monthIndex === 0} onClick={() => moveMonth(-1)}>‹</button>
        <strong aria-live="polite">Tháng {monthIndex + 1}/{year}</strong>
        <button type="button" aria-label="Tháng sau" disabled={year >= 9999 && monthIndex === 11} onClick={() => moveMonth(1)}>›</button>
      </div>
      <div className="vietnam-date-picker__days">
        {weekdays.map((day) => <span key={day} aria-hidden="true">{day}</span>)}
        {Array.from({ length: leading }, (_, index) => <span key={`pad-${index}`} />)}
        {Array.from({ length: monthDays }, (_, index) => {
          const date = new Date(Date.UTC(year, monthIndex, index + 1));
          const day = date.getTime() / millisecondsPerDay;
          const text = dateText(date);
          return <button type="button" key={index} aria-label={text} aria-pressed={day === selected} aria-current={day === today ? "date" : undefined} disabled={(minimum !== null && day < minimum) || (maximum !== null && day > maximum)} onClick={() => {
            onChange(text);
            setMonth(null);
            trigger.current?.focus();
          }}>{index + 1}</button>;
        })}
      </div>
    </div>}
  </div>;
}
