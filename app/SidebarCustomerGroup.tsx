"use client";

import { useId, useState } from "react";
import type { ReactNode } from "react";

// Preserve the incoming priority/time order while collecting one customer's
// rows. This keeps the most urgent customer's group at the top of the rail.
export function groupSidebarItems<T>(items: T[], keyFor: (item: T) => string) {
  const groups = new Map<string, { key: string; items: T[] }>();
  items.forEach((item) => {
    const key = keyFor(item);
    const group = groups.get(key);
    if (group) group.items.push(item);
    else groups.set(key, { key, items: [item] });
  });
  return Array.from(groups.values());
}

export default function SidebarCustomerGroup({ title, subtitle, count, countLabel, dotClass, stateClass = "", children }: {
  title: string;
  subtitle?: string;
  count: number;
  countLabel: string;
  dotClass?: string;
  stateClass?: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentsId = useId();
  return <div className={`sidebar-customer-group ${expanded ? "sidebar-customer-group--expanded" : ""}`}>
    <button type="button" className={`sidebar-customer-group__trigger ${stateClass}`.trim()} aria-expanded={expanded} aria-controls={contentsId} onClick={() => setExpanded((open) => !open)}>
      {dotClass && <i className={dotClass} aria-hidden="true" />}
      <span className="sidebar-customer-group__identity"><b>{title}</b>{subtitle && <small>{subtitle}</small>}</span>
      <span className="sidebar-customer-group__count" title={`${count} ${countLabel}`} aria-label={`${count} ${countLabel}`}>{count}</span>
      <span className="sidebar-customer-group__chevron" aria-hidden="true">{expanded ? "⌃" : "⌄"}</span>
    </button>
    <div id={contentsId} className="sidebar-customer-group__items" hidden={!expanded}>{children}</div>
  </div>;
}
