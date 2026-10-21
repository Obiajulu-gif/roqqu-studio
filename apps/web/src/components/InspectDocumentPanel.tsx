/**
 * Right inspect document pane — Figma Chat and Code panel (118:3740).
 * Header: format label (or JSON|Python toggle) + Copy; body: scrollable mono text.
 * Provenance: #152, #146.
 */
"use client";

import { useState, type ReactNode } from "react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

// Only the languages we render, so the bundle stays small (#211).
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("markdown", markdown);

export interface InspectFormatOption {
  id: string;
  label: string;
}

export interface InspectDocumentPanelProps {
  /** Shown as the left header label when no format toggle (e.g. Markdown). */
  formatLabel: string;
  content: string;
  emptyHint?: string;
  /** Optional Code-tab format switcher (#152). */
  formats?: InspectFormatOption[];
  activeFormat?: string;
  onFormatChange?: (id: string) => void;
  /** Muted hint next to a single-format label (e.g. "JSON coming soon"). */
  languagesNote?: string;
  /** Shown in the header row (e.g. generated Python filename). */
  subtitle?: string | null;
  busy?: boolean;
  /** Show a Download button that saves `content` as `subtitle`. */
  downloadable?: boolean;
  /** One-line, copyable "how to run this" shown under the header. */
  runHint?: string;
}

export function InspectDocumentPanel({
  formatLabel,
  content,
  emptyHint = "Nothing to show yet.",
  formats,
  activeFormat,
  onFormatChange,
  languagesNote,
  subtitle,
  busy = false,
  downloadable = false,
  runHint,
}: InspectDocumentPanelProps) {
  const [copied, setCopied] = useState(false);
  const text = content.trim();
  const langKey = (activeFormat ?? formatLabel).toLowerCase();
  const language =
    langKey === "python" || langKey === "javascript" || langKey === "json" ? langKey : "markdown";
  const isCode = language !== "markdown";

  function onDownload() {
    if (!text) return;
    const url = URL.createObjectURL(new Blob([`${text}\n`], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = subtitle || (language === "javascript" ? "flow.mjs" : "flow.py");
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onCopy() {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  let headLeft: ReactNode;
  if (formats && formats.length > 0 && onFormatChange) {
    headLeft = (
      <div
        className="studio-doc__formats"
        role="tablist"
        aria-label="Code format"
      >
        {formats.map((format) => (
          <button
            key={format.id}
            type="button"
            role="tab"
            aria-selected={activeFormat === format.id}
            className={
              activeFormat === format.id
                ? "studio-doc__format-tab is-active"
                : "studio-doc__format-tab"
            }
            disabled={busy}
            onClick={() => onFormatChange(format.id)}
          >
            {format.label}
          </button>
        ))}
      </div>
    );
  } else {
    headLeft = (
      <span className="studio-doc__format-single">
        <span className="studio-doc__format">{formatLabel}</span>
        {languagesNote ? (
          <span className="studio-doc__lang-note">{languagesNote}</span>
        ) : null}
      </span>
    );
  }

  return (
    <div className="studio-doc">
      <div className="studio-doc__head">
        <div className="studio-doc__head-start">
          {headLeft}
          {subtitle && !runHint ? (
            <span className="studio-doc__filename">{subtitle}</span>
          ) : null}
        </div>
        <button
          type="button"
          className="studio-doc__copy"
          onClick={() => void onCopy()}
          disabled={!text || busy}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden
          >
            <rect
              x="3.5"
              y="3.5"
              width="7"
              height="7"
              rx="1.2"
              stroke="currentColor"
              strokeWidth="1.1"
            />
            <path
              d="M8.5 3.5V2.7A1.2 1.2 0 0 0 7.3 1.5H2.7A1.2 1.2 0 0 0 1.5 2.7v4.6A1.2 1.2 0 0 0 2.7 8.5H3.5"
              stroke="currentColor"
              strokeWidth="1.1"
            />
          </svg>
          {copied ? "Copied" : "Copy"}
        </button>
        {downloadable ? (
          <button
            type="button"
            className="studio-doc__copy"
            onClick={onDownload}
            disabled={!text || busy}
          >
            Download
          </button>
        ) : null}
      </div>
      {runHint && text ? (
        <div className="studio-doc__meta">
          {subtitle ? <code className="studio-doc__file">{subtitle}</code> : null}
          <p className="studio-doc__run">
            <span>Run it:</span> <code>{runHint}</code>
          </p>
        </div>
      ) : null}
      <div className="studio-doc__body">
        {busy && !text ? (
          <p className="studio-doc__empty">Generating…</p>
        ) : text ? (
          <SyntaxHighlighter
            language={language}
            style={oneDark}
            /* Line numbers + wrapping makes every token a flex item and breaks
               the layout; code scrolls sideways instead, prose wraps. */
            showLineNumbers={isCode}
            wrapLongLines={!isCode}
            className={`studio-doc__code${isCode ? " is-code" : ""}`}
            customStyle={{
              margin: 0,
              padding: "16px 0 16px 4px",
              borderRadius: "10px",
              fontSize: "12.5px",
              lineHeight: "1.65",
              background: "#0a0f1a",
              overflowX: "auto",
            }}
            codeTagProps={{
              style: {
                fontFamily:
                  "var(--font-mono, 'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, monospace)",
                letterSpacing: "0.1px",
              },
            }}
            lineNumberStyle={{
              color: "#495162",
              minWidth: "2.6em",
              paddingRight: "1.1em",
              userSelect: "none",
            }}
          >
            {text}
          </SyntaxHighlighter>
        ) : (
          <p className="studio-doc__empty">{emptyHint}</p>
        )}
      </div>
    </div>
  );
}
