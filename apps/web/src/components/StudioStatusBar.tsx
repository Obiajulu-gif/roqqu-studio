/**
 * IDE-style status bar for the studio canvas: run mode, Roqqu reachability,
 * flow size, safety findings and the last run, always in view.
 */
"use client";

import { useEffect, useState } from "react";

import { getJson } from "@/lib/http";

export interface StudioStatusBarProps {
  live: boolean;
  blockCount: number;
  findingCount: number | null;
  running: boolean;
  runStatus: string | null;
}

type Reach = "checking" | "up" | "down";

export function StudioStatusBar({
  live,
  blockCount,
  findingCount,
  running,
  runStatus,
}: StudioStatusBarProps) {
  const [reach, setReach] = useState<Reach>("checking");

  useEffect(() => {
    let alive = true;
    getJson("/roqqu/prices")
      .then(() => alive && setReach("up"))
      .catch(() => alive && setReach("down"));
    return () => {
      alive = false;
    };
  }, []);

  const safety =
    findingCount === null
      ? "Not reviewed yet"
      : findingCount === 0
        ? "Safety review passed"
        : `${findingCount} safety ${findingCount === 1 ? "issue" : "issues"}`;

  return (
    <footer className="rq-status" aria-label="Studio status">
      <span className={`rq-status__item ${live ? "is-live" : "is-practice"}`}>
        <i aria-hidden />
        {live ? "Live on Roqqu" : "Practice mode"}
      </span>
      <span className={`rq-status__item is-${reach}`}>
        <i aria-hidden />
        {reach === "checking" ? "Checking Roqqu API" : reach === "up" ? "Roqqu API reachable" : "Roqqu API unreachable"}
      </span>
      <span className="rq-status__item">
        <code>{blockCount}</code> {blockCount === 1 ? "block" : "blocks"}
      </span>
      <span
        className={`rq-status__item ${findingCount ? "is-warn" : findingCount === 0 ? "is-ok" : ""}`}
      >
        {safety}
      </span>
      <span className="rq-status__item rq-status__run">
        {running ? "Running…" : runStatus ? `Last run ${runStatus}` : "No runs yet"}
      </span>
    </footer>
  );
}
