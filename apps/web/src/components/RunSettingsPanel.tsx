/**
 * Explicit execution mode plus write-only Roqqu credentials.
 * The default remains mock/practice execution (#202).
 */
"use client";

import type { ExecutionAdapter } from "@/types";
import { CredentialsForm } from "./CredentialsForm";

export interface RunSettingsPanelProps {
  adapter: ExecutionAdapter;
  workflowId: string | null;
  busy: boolean;
  onAdapterChange: (adapter: ExecutionAdapter) => void;
}

export function RunSettingsPanel({
  adapter,
  workflowId,
  busy,
  onAdapterChange,
}: RunSettingsPanelProps) {
  return (
    <section className="studio-run-settings" aria-label="Run settings">
      <div className="studio-run-settings__head">
        <h2>Run settings</h2>
        <p>Choose how this workflow runs.</p>
      </div>
      <fieldset className="studio-run-settings__mode" disabled={busy}>
        <legend>Execution mode</legend>
        <label>
          <input
            type="radio"
            name="execution-adapter"
            checked={adapter === "mock"}
            onChange={() => onAdapterChange("mock")}
          />
          <span>
            <strong>Practice</strong>
            <small>Simulated run with no Roqqu request.</small>
          </span>
        </label>
        <label>
          <input
            type="radio"
            name="execution-adapter"
            checked={adapter === "roqqu"}
            onChange={() => onAdapterChange("roqqu")}
          />
          <span>
            <strong>Live on Roqqu</strong>
            <small>Calls the real Roqqu API with your saved key. A test key moves no real money; a live key does.</small>
          </span>
        </label>
      </fieldset>
      <CredentialsForm workflowId={workflowId} busy={busy} />
    </section>
  );
}
