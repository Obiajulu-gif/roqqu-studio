/**
 * Business overview: every tool one click away, grouped by intent, with what
 * just happened beside it. Big targets (Fitts's law), four groups (Miller).
 */
"use client";

import Link from "next/link";

import { CryptoRates } from "@/components/CryptoRates";
import { RecentServiceActivity } from "@/components/ServicePanels";

import { ToolIcon } from "./BusinessShell";
import { TOOL_GROUPS, TOOLS } from "./tools";

export function BusinessOverview() {
  return (
    <div className="bz-overview">
      <div className="bz-overview__tools">
        {TOOL_GROUPS.map((group) => (
          <section key={group.name} className="bz-cluster" aria-labelledby={`g-${group.name}`}>
            <header>
              <h2 id={`g-${group.name}`}>{group.name}</h2>
              <p>{group.lead}</p>
            </header>
            <div className="bz-cards">
              {TOOLS.filter((t) => t.group === group.name).map((t) => (
                <Link key={t.slug} href={`/studio/business/${t.slug}`} className="bz-card">
                  <span className="bz-card__icon"><ToolIcon d={t.icon} size={22} /></span>
                  <span className="bz-card__text">
                    <b>{t.title}</b>
                    <span>{t.blurb}</span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
      <aside className="bz-overview__side">
        <CryptoRates />
        <section className="bz-recent" aria-labelledby="recent-title">
          <h2 id="recent-title">Recent activity</h2>
          <RecentServiceActivity />
        </section>
        <p className="bz-practice-note">
          Every tool starts in Practice: simulated with Roqqu&apos;s response shapes, no money moves.
          Switch a tool to Live once your Roqqu key is set on the server.
        </p>
      </aside>
    </div>
  );
}
