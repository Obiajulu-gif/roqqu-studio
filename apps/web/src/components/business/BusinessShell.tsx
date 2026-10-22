/**
 * Business workspace frame: a grouped sidebar (Jakob's law: the layout people
 * already know from banking apps), one page per tool, and a header that always
 * says where you are and whether money is real.
 */
"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { Onboarding } from "./Onboarding";
import { TOOL_GROUPS, TOOLS, toolBySlug } from "./tools";
import { BusinessProvider, useBusiness } from "./useBusiness";

export function ToolIcon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d={d} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BusinessShell({ children }: { children: ReactNode }) {
  return (
    <BusinessProvider>
      <Suspense>
        <Gate>{children}</Gate>
      </Suspense>
    </BusinessProvider>
  );
}

/** Onboarding first; the workspace only once a business is signed in. */
function Gate({ children }: { children: ReactNode }) {
  const { state } = useBusiness();
  if (state.kind === "loading") return <div className="ob"><p className="ob-loading">Loading your business…</p></div>;
  if (state.kind === "signed_out") return <Onboarding />;
  if (state.kind === "unavailable") {
    return (
      <div className="ob">
        <div className="ob-card">
          <h1>Business accounts are not set up</h1>
          <div className="svc-notice is-info">{state.message}</div>
          <p className="ob-lead">The flow canvas, API playground and templates still work without it.</p>
          <Link href="/studio" className="svc-btn">Back to the studio</Link>
        </div>
      </div>
    );
  }
  return <Workspace business={state.me.business} mode={state.me.mode}>{children}</Workspace>;
}

function Workspace({
  children,
  business,
  mode,
}: {
  children: ReactNode;
  business: { business_name: string; owner_name: string; slug: string };
  mode: "practice" | "test" | "live";
}) {
  const { signOut } = useBusiness();
  const pathname = usePathname() ?? "/studio/business";
  const router = useRouter();
  const slug = pathname.split("/")[3];
  const tool = slug ? toolBySlug(slug) : undefined;

  return (
    <div className="bz">
      <aside className="bz-side" aria-label="Business tools">
        <Link href="/studio" className="bz-brand">
          <Image src="/figma/roqqu-logo.svg" alt="" width={24} height={24} />
          <span>Roqqu Studio</span>
        </Link>
        <nav className="bz-nav">
          <Link href="/studio/business" className={`bz-link${!tool ? " is-on" : ""}`} aria-current={!tool ? "page" : undefined}>
            <ToolIcon d="M4 11 12 4l8 7v8H4v-8Zm6 8v-5h4v5" />
            Overview
          </Link>
          {TOOL_GROUPS.map((group) => (
            <div key={group.name} className="bz-group">
              <p className="bz-group__name">{group.name}</p>
              {TOOLS.filter((t) => t.group === group.name).map((t) => (
                <Link
                  key={t.slug}
                  href={`/studio/business/${t.slug}`}
                  className={`bz-link${tool?.slug === t.slug ? " is-on" : ""}`}
                  aria-current={tool?.slug === t.slug ? "page" : undefined}
                >
                  <ToolIcon d={t.icon} />
                  {t.title}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="bz-side__foot">
          <div className="bz-who">
            <b>{business.business_name}</b>
            <span>{business.owner_name}</span>
            <span className={`bz-mode is-${mode}`}>
              {mode === "practice" ? "Practice" : mode === "test" ? "Roqqu test mode" : "Live"}
            </span>
            <button type="button" className="svc-link" onClick={() => void signOut()}>Sign out</button>
          </div>
          <Link href="/studio/developer" className="bz-link">
            <ToolIcon d="M8 7 3 12l5 5m8-10 5 5-5 5" />
            Developer tools
          </Link>
          <Link href="/studio/canvas" className="bz-link">
            <ToolIcon d="M5 6h5v5H5V6Zm9 7h5v5h-5v-5ZM10 8.5h2.5a1 1 0 0 1 1 1v6" />
            Flow canvas
          </Link>
        </div>
      </aside>

      {/* Small screens: one native picker instead of a sidebar. */}
      <div className="bz-mobile">
        <Link href="/studio" className="bz-brand">
          <Image src="/figma/roqqu-logo.svg" alt="" width={22} height={22} />
          <span>Roqqu Studio</span>
        </Link>
        <select
          aria-label="Go to"
          value={tool ? `/studio/business/${tool.slug}` : "/studio/business"}
          onChange={(e) => router.push(e.target.value)}
        >
          <option value="/studio/business">Overview</option>
          {TOOL_GROUPS.map((g) => (
            <optgroup key={g.name} label={g.name}>
              {TOOLS.filter((t) => t.group === g.name).map((t) => (
                <option key={t.slug} value={`/studio/business/${t.slug}`}>{t.title}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <main className="bz-main">
        <header className="bz-head">
          {tool ? (
            <nav className="bz-crumbs" aria-label="Breadcrumb">
              <Link href="/studio/business">Overview</Link>
              <span aria-hidden>/</span>
              <span>{tool.group}</span>
            </nav>
          ) : null}
          <h1>{tool ? tool.title : business.business_name}</h1>
          <p>{tool ? tool.blurb : `Welcome back, ${business.owner_name.split(" ")[0]}. Everything you run on Roqqu, in one place.`}</p>
        </header>
        <div className="bz-body">{children}</div>
      </main>
    </div>
  );
}
