/**
 * OutfitPanel — shown below an assistant message when outfit items are present.
 *
 * Props:
 *   items      — initially selected items [{_id, name, type, color, image_url, brand}]
 *   candidates — full pool grouped by type { top: [...], bottom: [...], shoes: [...] }
 */
import { useState } from "react";
import "./OutfitPanel.css";

const TYPE_ICONS = {
  top: "👕", bottom: "👖", shoes: "👟", outerwear: "🧥",
  dress: "👗", accessory: "🧢", shirt: "👔", pants: "👖", socks: "🧦",
};

const CSS_COLORS = {
  black: "#1a1a1a", white: "#f0f0f0", grey: "#9e9e9e", gray: "#9e9e9e",
  navy: "#1e3a6e", blue: "#3b7dd8", red: "#d93025", green: "#2d8a4e",
  brown: "#8b5e3c", beige: "#d4b896", khaki: "#c3b091", pink: "#e91e8c",
  yellow: "#f5c518", orange: "#f57c00", purple: "#7b1fa2", burgundy: "#800020",
  coral: "#ff6b6b", olive: "#6b7c2e", teal: "#008080",
};

function colorStyle(name) {
  return CSS_COLORS[name?.toLowerCase()] ?? "#555";
}

// Today + 13 days for the quick-pick date strip
function getDateStrip() {
  const days = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  return days;
}

function fmtDate(d) {
  return d.toISOString().split("T")[0];
}

function fmtLabel(d) {
  const today = new Date();
  const diff = Math.round((d - today) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export default function OutfitPanel({ items: rawItems, candidates }) {
  // Deduplicate by type — keep first occurrence per type
  const items = rawItems.filter(
    (item, idx, arr) => arr.findIndex((i) => i.type === item.type) === idx
  );

  // Track current index per type within the candidate pool
  const [indices, setIndices] = useState(() => {
    const init = {};
    items.forEach((item) => { init[item.type] = 0; });
    return init;
  });

  // accepted: true = kept, false = rejected, undefined = undecided
  const [accepted, setAccepted] = useState({});
  // removed: types the user explicitly dismissed from the outfit
  const [removed, setRemoved] = useState(new Set());
  const [showCalendar, setShowCalendar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [visualizing, setVisualizing] = useState(false);
  const [vizImage, setVizImage] = useState(null);
  const [vizError, setVizError] = useState(null);

  function remove(type) {
    setRemoved((prev) => new Set([...prev, type]));
    setAccepted((prev) => { const n = { ...prev }; delete n[type]; return n; });
  }

  // Build the displayed item per type, excluding removed types
  const displayedItems = items
    .filter((item) => !removed.has(item.type))
    .map((item) => {
      const pool = candidates[item.type] ?? [item];
      const idx = indices[item.type] ?? 0;
      return pool[idx] ?? item;
    });

  function swap(type) {
    const pool = candidates[type] ?? [];
    if (pool.length <= 1) return;
    setIndices((prev) => {
      const next = ((prev[type] ?? 0) + 1) % pool.length;
      return { ...prev, [type]: next };
    });
    // Reset accept state for this type when swapped
    setAccepted((prev) => ({ ...prev, [type]: undefined }));
  }

  function accept(type) {
    setAccepted((prev) => ({ ...prev, [type]: true }));
  }

  function reject(type) {
    swap(type);
    setAccepted((prev) => ({ ...prev, [type]: false }));
  }

  const allDecided = displayedItems.every((item) => accepted[item.type] === true);
  const anyAccepted = displayedItems.some((item) => accepted[item.type] === true);

  async function visualizeOutfit() {
    const acceptedItems = displayedItems.filter((item) => accepted[item.type] === true);
    if (!acceptedItems.length) return;
    setVisualizing(true);
    setVizImage(null);
    setVizError(null);
    try {
      const res = await fetch("/api/visualize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_ids: acceptedItems.map((i) => i._id) }),
      });
      const data = await res.json();
      if (data.image) {
        setVizImage(`data:image/png;base64,${data.image}`);
      } else {
        setVizError(data.error || "Could not generate visualization.");
      }
    } catch {
      setVizError("Network error generating visualization.");
    } finally {
      setVisualizing(false);
    }
  }

  async function saveToCalendar(date, occasion) {
    const acceptedItems = displayedItems.filter((item) => accepted[item.type] === true);
    if (!acceptedItems.length) return;
    setSaving(true);
    // Strip the data-URL prefix before storing — backend re-adds it on read
    const imageB64 = vizImage ? vizImage.replace(/^data:[^;]+;base64,/, "") : "";
    await fetch("/api/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date,
        occasion,
        item_ids: acceptedItems.map((i) => i._id),
        visualization_image: imageB64,
      }),
    });
    setSaving(false);
    setSaved(true);
    setShowCalendar(false);
    setTimeout(() => setSaved(false), 3000);
  }

  return (
    <div className="outfit-panel">
      <div className="outfit-panel-header">
        <span className="outfit-panel-label">Suggested outfit</span>
        {saved && <span className="saved-badge">✓ Added to calendar</span>}
      </div>

      <div className="outfit-cards-row">
        {displayedItems.map((item) => {
          const pool = candidates[item.type] ?? [item];
          const hasAlts = pool.length > 1;
          const state = accepted[item.type]; // true | false | undefined

          return (
            <div
              key={item.type}
              className={`outfit-item-card ${state === true ? "accepted" : state === false ? "rejected" : ""}`}
            >
              <div className="oi-img">
                {item.image_url && !item._imgErr ? (
                  <img
                    src={item.image_url}
                    alt={item.name}
                    onError={(e) => { e.target.style.display = "none"; }}
                  />
                ) : (
                  <span className="oi-icon">{TYPE_ICONS[item.type] ?? "👔"}</span>
                )}
                {state === true && <div className="oi-accepted-badge">✓</div>}
              </div>

              <div className="oi-info">
                <p className="oi-name">{item.name}</p>
                <div className="oi-meta">
                  <span className="oi-type">{item.type}</span>
                </div>
                {item.brand && <p className="oi-brand">{item.brand}</p>}
                {item.occasion?.length > 0 && (
                  <div className="oi-tags">
                    {item.occasion.slice(0, 2).map((o) => (
                      <span key={o} className="oi-tag">{o}</span>
                    ))}
                  </div>
                )}
              </div>

              <div className="oi-actions">
                {state !== true ? (
                  <button className="oi-btn accept" onClick={() => accept(item.type)} title="Keep this">
                    ✓
                  </button>
                ) : (
                  <button className="oi-btn accepted-btn" onClick={() => setAccepted((p) => ({ ...p, [item.type]: undefined }))} title="Undo">
                    ✓
                  </button>
                )}
                {hasAlts && (
                  <button className="oi-btn swap" onClick={() => swap(item.type)} title="Try another">
                    →
                  </button>
                )}
              </div>

              {hasAlts && (
                <div className="oi-pool-dots">
                  {pool.map((_, i) => (
                    <span
                      key={i}
                      className={`pool-dot ${i === (indices[item.type] ?? 0) ? "active" : ""}`}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {anyAccepted && !showCalendar && (
        <div className="outfit-action-row">
          <button className="add-to-cal-btn" onClick={() => setShowCalendar(true)}>
            📅 Add to calendar
          </button>
          <button
            className="visualize-btn"
            onClick={visualizeOutfit}
            disabled={visualizing}
          >
            {visualizing ? "✨ Generating…" : "✨ Visualize"}
          </button>
          {/* Hide Accessorize once an accessory is already in the accepted outfit */}
          {!displayedItems.some(
            (item) => item.type === "accessory" && accepted[item.type] === true
          ) && (
            <button
              className="accessorize-btn"
              onClick={() => {
                const acceptedItems = displayedItems.filter(
                  (item) => accepted[item.type] === true
                );
                const names = acceptedItems.map((item) => item.name).join(", ");
                window.dispatchEvent(new CustomEvent("virgo:prefill-chat", {
                  detail: {
                    text: `What accessories from my wardrobe would go well with this outfit: ${names}?`,
                    carryItems: acceptedItems,
                  },
                }));
              }}
            >
              💍 Accessorize
            </button>
          )}
        </div>
      )}

      {vizImage && (
        <div className="viz-result">
          <div className="viz-label">AI outfit visualization</div>
          <img src={vizImage} alt="Outfit visualization" className="viz-image" />
        </div>
      )}
      {vizError && <p className="viz-error">{vizError}</p>}

      {showCalendar && (
        <CalendarPicker
          onSave={saveToCalendar}
          onClose={() => setShowCalendar(false)}
          saving={saving}
        />
      )}
    </div>
  );
}

function CalendarPicker({ onSave, onClose, saving }) {
  const dates = getDateStrip();
  const [selected, setSelected] = useState(fmtDate(dates[0]));
  const [occasion, setOccasion] = useState("");

  return (
    <div className="cal-picker">
      <div className="cal-picker-header">
        <span>When are you wearing this?</span>
        <button className="cal-picker-close" onClick={onClose}>✕</button>
      </div>

      <div className="date-strip">
        {dates.map((d) => {
          const val = fmtDate(d);
          return (
            <button
              key={val}
              className={`date-chip ${selected === val ? "active" : ""}`}
              onClick={() => setSelected(val)}
            >
              {fmtLabel(d)}
            </button>
          );
        })}
      </div>

      <div className="cal-picker-row">
        <input
          className="occasion-input"
          placeholder="Occasion (optional)"
          value={occasion}
          onChange={(e) => setOccasion(e.target.value)}
        />
        <button
          className="cal-save-btn"
          onClick={() => onSave(selected, occasion)}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
