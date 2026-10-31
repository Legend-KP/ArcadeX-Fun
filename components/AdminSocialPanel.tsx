"use client";

import { useEffect, useState } from "react";
import {
  fetchAdminNotifications,
  fetchAdminReports,
  resolveAdminReport,
  sendAdminNotification,
  type AdminBroadcast,
  type AdminCamp,
  type AdminReport,
} from "@/lib/admin-api";

export default function AdminSocialPanel({ onToast }: { onToast: (message: string) => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [camp, setCamp] = useState("");
  const [camps, setCamps] = useState<AdminCamp[]>([]);
  const [broadcasts, setBroadcasts] = useState<AdminBroadcast[]>([]);
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [notes, open] = await Promise.all([
      fetchAdminNotifications(),
      fetchAdminReports(),
    ]);
    setCamps(notes.camps);
    setBroadcasts(notes.broadcasts);
    setReports(open);
  }

  useEffect(() => {
    void refresh().catch((err: unknown) => {
      onToast(err instanceof Error ? err.message : "Could not load notifications.");
    });
    // Load once when the portal opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const selected = camps.find((item) => `${item.kind}:${item.id}` === camp);
    try {
      await sendAdminNotification({
        title,
        body,
        campKind: selected?.kind ?? null,
        campId: selected?.id ?? null,
      });
      setTitle("");
      setBody("");
      setCamp("");
      await refresh();
      onToast("Notification sent to every signed-in player.");
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Could not send the notification.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(id: string, action: "remove" | "dismiss") {
    try {
      await resolveAdminReport(id, action);
      setReports((current) => current.filter((report) => report.id !== id));
      onToast(action === "remove" ? "Content removed." : "Report dismissed.");
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Could not update the report.");
    }
  }

  return (
    <>
      <h2 className="admin-section-title">App notifications</h2>
      <div className="add-game-card">
        <p className="form-label">
          This goes to the in-app notification bar. It does not send email.
        </p>
        <form onSubmit={(event) => void send(event)}>
          <div className="form-group">
            <label className="form-label">Title</label>
            <input className="form-input" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} required />
          </div>
          <div className="form-group">
            <label className="form-label">Message</label>
            <input className="form-input" value={body} onChange={(event) => setBody(event.target.value)} maxLength={280} required />
          </div>
          <div className="form-group">
            <label className="form-label">Camp</label>
            <select className="form-input" value={camp} onChange={(event) => setCamp(event.target.value)}>
              <option value="">No camp</option>
              {camps.map((item) => (
                <option key={`${item.kind}:${item.id}`} value={`${item.kind}:${item.id}`}>
                  {item.kind === "circle" ? "Circle" : "Game"} · {item.label}
                </option>
              ))}
            </select>
          </div>
          <button className="add-submit-btn" type="submit" disabled={busy}>
            {busy ? "Sending..." : "Send to everyone"}
          </button>
        </form>
        <ul className="admin-list">
          {broadcasts.map((item) => (
            <li key={item.id}>
              <strong>{item.title}</strong>
              <span> {item.body}</span>
              {item.href && <span> → {item.href}</span>}
            </li>
          ))}
        </ul>
      </div>

      <h2 className="admin-section-title">Content reports</h2>
      <div className="add-game-card">
        {reports.length === 0 && <p className="form-label">No open reports.</p>}
        <ul className="admin-list">
          {reports.map((report) => (
            <li key={report.id}>
              <strong>{report.targetKind}</strong>
              <span> · {report.reason}</span>
              <button type="button" onClick={() => void decide(report.id, "remove")}>
                Remove
              </button>
              <button type="button" onClick={() => void decide(report.id, "dismiss")}>
                Dismiss
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
