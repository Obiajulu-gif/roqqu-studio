/**
 * BYO Roqqu credentials for the active workflow.
 * Provenance: #68, #55, D19.
 */
"use client";

import { useEffect, useState, type FormEvent } from "react";

import { fetchCredentialStatus, putCredentials } from "@/lib/api";
import type { CredentialStatus } from "@/types";

export interface CredentialsFormProps {
  workflowId: string | null;
  busy: boolean;
}

export function CredentialsForm({ workflowId, busy }: CredentialsFormProps) {
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!workflowId) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    void fetchCredentialStatus(workflowId).then((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
    };
  }, [workflowId]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!workflowId) return;
    setSaving(true);
    setMessage(null);
    try {
      const next = await putCredentials(workflowId, {
        secret_key: secretKey.trim(),
        webhook_secret: webhookSecret.trim(),
      });
      setStatus(next);
      setSecretKey("");
      setWebhookSecret("");
      setMessage("Credentials saved for this workflow.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!workflowId) {
    return (
      <div className="studio-creds">
        <h3>Connect your Roqqu account</h3>
        <p className="muted">Open a workflow to attach your Roqqu keys.</p>
      </div>
    );
  }

  return (
    <div className="studio-creds">
      <h3>Connect your Roqqu account</h3>
      <p className="muted">
        {status?.configured
          ? `Configured (${status.source}). Values are write-only.`
          : "Optional: Practice runs need no keys. Roqqu has no sandbox, so live calls move real crypto."}
      </p>
      <form className="studio-creds__form" onSubmit={onSubmit}>
        <label>
          Secret key (RQ-SEC-…, dashboard → Security)
          <input
            type="password"
            autoComplete="off"
            value={secretKey}
            onChange={(event) => setSecretKey(event.target.value)}
            disabled={busy || saving}
            required
          />
        </label>
        <label>
          Webhook secret (set beside your webhook URL)
          <input
            type="password"
            autoComplete="off"
            value={webhookSecret}
            onChange={(event) => setWebhookSecret(event.target.value)}
            disabled={busy || saving}
          />
        </label>
        <button
          type="submit"
          className="studio-btn studio-btn--primary"
          disabled={busy || saving}
        >
          {saving ? "Saving…" : "Save credentials"}
        </button>
      </form>
      {message && <p className="studio-creds__msg">{message}</p>}
    </div>
  );
}
