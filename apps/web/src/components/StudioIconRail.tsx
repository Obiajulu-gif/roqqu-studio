/**
 * Far-left icon rail from Figma Main (21:1670).
 * Icons: exact Figma exports in /public/figma/.
 */
"use client";

import Image from "next/image";

export interface StudioIconRailProps {
  active?: "workflow" | "dashboard" | "new";
  onNew?: () => void;
  onDashboard?: () => void;
  /** Draw the eye to the Dashboard (e.g. a run just produced new outflow). */
  nudgeDashboard?: boolean;
}

export function StudioIconRail({
  active = "workflow",
  onNew,
  onDashboard,
  nudgeDashboard = false,
}: StudioIconRailProps) {
  return (
    <nav className="studio-rail" aria-label="Studio navigation">
      <div className="studio-rail__logo">
        <Image
          src="/figma/roqqu-logo-rail.svg"
          alt="Roqqu"
          width={18}
          height={18}
          unoptimized
        />
      </div>
      <div className="studio-rail__sep" aria-hidden />
      <div className="studio-rail__items">
        <button
          type="button"
          className={`studio-rail__btn${active === "new" ? " is-active" : ""}`}
          title="New workflow"
          aria-label="New workflow"
          onClick={onNew}
        >
          <Image
            src="/figma/icon-rail-plus.svg"
            alt=""
            width={16}
            height={16}
            unoptimized
          />
        </button>
        <button
          type="button"
          className={`studio-rail__btn${active === "dashboard" ? " is-active" : ""}${
            nudgeDashboard && active !== "dashboard" ? " is-nudging" : ""
          }`}
          title={nudgeDashboard ? "New activity - open your Dashboard" : "Dashboard"}
          aria-label="Dashboard"
          onClick={onDashboard}
        >
          <Image
            src="/figma/icon-rail-grid.svg"
            alt=""
            width={16}
            height={16}
            unoptimized
          />
        </button>
        <button
          type="button"
          className={`studio-rail__btn${active === "workflow" ? " is-active" : ""}`}
          title="Workflow canvas"
          aria-label="Workflow canvas"
          aria-current={active === "workflow" ? "page" : undefined}
        >
          <Image
            src="/figma/icon-rail-workflow.svg"
            alt=""
            width={16}
            height={16}
            unoptimized
          />
        </button>
        <a
          href="/studio/playground"
          className="studio-rail__btn studio-rail__btn--code"
          title="Roqqu API playground"
          aria-label="Roqqu API playground"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      </div>
    </nav>
  );
}
