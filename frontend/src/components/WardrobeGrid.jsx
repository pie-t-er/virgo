import { useEffect, useState } from "react";
import "./WardrobeGrid.css";

const ALL_TYPE_FILTERS = ["all", "top", "bottom", "shoes", "outerwear", "dress", "accessory"];
const MEN_TYPE_FILTERS  = ALL_TYPE_FILTERS.filter((t) => t !== "dress");

const TYPE_OPTIONS  = ["top", "bottom", "shoes", "outerwear", "dress", "accessory"];
const COLOR_OPTIONS = ["black", "white", "grey", "navy", "blue", "red", "green",
  "brown", "beige", "khaki", "pink", "yellow", "orange", "purple", "burgundy",
  "coral", "olive", "teal", "multicolor"];
const OCCASION_OPTIONS = ["casual", "work", "formal", "party", "outdoor", "beach", "sporty"];
const SEASON_OPTIONS   = ["spring", "summer", "fall", "winter"];

export default function WardrobeGrid({ refreshKey }) {
  const [items, setItems]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch]     = useState("");
  const [gender, setGender]     = useState(null);
  const [showAdd, setShowAdd]   = useState(false);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((p) => setGender(p.gender || ""))
      .catch(() => setGender(""));
  }, [refreshKey]);

  useEffect(() => {
    if (gender === null) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (typeFilter !== "all") params.set("type", typeFilter);
    if (gender) params.set("gender", gender);
    fetch(`/api/wardrobe?${params}`)
      .then((r) => r.json())
      .then((data) => { setItems(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [typeFilter, gender, refreshKey]);

  const filtered = search
    ? items.filter((it) =>
        it.name?.toLowerCase().includes(search.toLowerCase()) ||
        it.brand?.toLowerCase().includes(search.toLowerCase()) ||
        it.color?.join(" ").toLowerCase().includes(search.toLowerCase())
      )
    : items;

  async function deleteItem(id) {
    await fetch(`/api/wardrobe/${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((it) => it._id !== id));
  }

  async function handleAdd(formData) {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: buildAddMessage(formData),
      }),
    });
    if (res.ok) {
      setShowAdd(false);
      // Reload wardrobe
      const params = new URLSearchParams();
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (gender) params.set("gender", gender);
      fetch(`/api/wardrobe?${params}`)
        .then((r) => r.json())
        .then(setItems);
    }
  }

  const typeFilters = gender === "men" ? MEN_TYPE_FILTERS : ALL_TYPE_FILTERS;

  return (
    <div className="wardrobe">
      <div className="wardrobe-controls">
        <input
          className="wardrobe-search"
          placeholder="Search by name, brand, or color…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="type-filters">
          {typeFilters.map((t) => (
            <button
              key={t}
              className={`type-chip ${typeFilter === t ? "active" : ""}`}
              onClick={() => setTypeFilter(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <button className="add-item-btn" onClick={() => setShowAdd(true)}>
          + Add item
        </button>
      </div>

      {loading ? (
        <div className="wardrobe-loading">
          <div className="skeleton-grid">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="skeleton-card">
                <div className="skeleton-img shimmer" />
                <div className="skeleton-line shimmer" style={{ width: "80%" }} />
                <div className="skeleton-line shimmer" style={{ width: "50%" }} />
              </div>
            ))}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="wardrobe-empty">
          <p>Nothing here yet.</p>
          <button className="add-item-btn" onClick={() => setShowAdd(true)}>
            + Add your first item
          </button>
        </div>
      ) : (
        <div className="wardrobe-grid">
          {filtered.map((item) => (
            <ItemCard key={item._id} item={item} onDelete={() => deleteItem(item._id)} />
          ))}
        </div>
      )}

      {showAdd && (
        <AddItemModal
          gender={gender}
          onSave={handleAdd}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}

function buildAddMessage(f) {
  const parts = [`Add a ${f.colors.join(" and ")} ${f.name}`];
  if (f.brand) parts[0] += ` by ${f.brand}`;
  parts.push(`type: ${f.type}`);
  if (f.occasions.length) parts.push(`occasions: ${f.occasions.join(", ")}`);
  if (f.seasons.length)   parts.push(`seasons: ${f.seasons.join(", ")}`);
  if (f.imageUrl)         parts.push(`image_url: ${f.imageUrl}`);
  return parts.join(", ");
}

function AddItemModal({ gender, onSave, onClose }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "", type: "top", brand: "",
    colors: [], occasions: [], seasons: [], imageUrl: "",
  });

  function toggle(field, value) {
    setForm((f) => ({
      ...f,
      [field]: f[field].includes(value)
        ? f[field].filter((v) => v !== value)
        : [...f[field], value],
    }));
  }

  async function handleSave() {
    if (!form.name || !form.type || form.colors.length === 0) return;
    setSaving(true);
    await onSave(form);
    setSaving(false);
  }

  const typeOpts = gender === "men"
    ? TYPE_OPTIONS.filter((t) => t !== "dress")
    : TYPE_OPTIONS;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="add-modal" onClick={(e) => e.stopPropagation()}>
        <div className="add-modal-header">
          <h2>Add clothing item</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="add-modal-body">
          <div className="add-field">
            <label>Name *</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. White Oxford Shirt"
            />
          </div>

          <div className="add-field">
            <label>Type *</label>
            <div className="pill-group">
              {typeOpts.map((t) => (
                <button
                  key={t}
                  className={`pill ${form.type === t ? "active" : ""}`}
                  onClick={() => setForm((f) => ({ ...f, type: t }))}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="add-field">
            <label>Colors * <span className="field-hint">(select all that apply)</span></label>
            <div className="color-pill-group">
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c}
                  className={`color-pill ${form.colors.includes(c) ? "active" : ""}`}
                  onClick={() => toggle("colors", c)}
                  title={c}
                >
                  <span className="color-swatch-btn" style={{ background: CSS_COLORS[c] }} />
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="add-field">
            <label>Occasions</label>
            <div className="pill-group">
              {OCCASION_OPTIONS.map((o) => (
                <button
                  key={o}
                  className={`pill ${form.occasions.includes(o) ? "active" : ""}`}
                  onClick={() => toggle("occasions", o)}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>

          <div className="add-field">
            <label>Seasons</label>
            <div className="pill-group">
              {SEASON_OPTIONS.map((s) => (
                <button
                  key={s}
                  className={`pill ${form.seasons.includes(s) ? "active" : ""}`}
                  onClick={() => toggle("seasons", s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="add-field-row">
            <div className="add-field">
              <label>Brand</label>
              <input
                value={form.brand}
                onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
                placeholder="e.g. Uniqlo"
              />
            </div>
            <div className="add-field">
              <label>Image URL</label>
              <input
                value={form.imageUrl}
                onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
                placeholder="https://…"
              />
            </div>
          </div>
        </div>

        <div className="add-modal-footer">
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button
            className="btn-save"
            onClick={handleSave}
            disabled={!form.name || form.colors.length === 0 || saving}
          >
            {saving ? "Adding…" : "Add to wardrobe"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ItemCard({ item, onDelete }) {
  const [imgErr, setImgErr] = useState(false);
  const colorDot = item.color?.[0];

  return (
    <div className="item-card">
      <div className="item-img-wrap">
        {item.image_url && !imgErr ? (
          <img src={item.image_url} alt={item.name} onError={() => setImgErr(true)} loading="lazy" />
        ) : (
          <div className="item-img-placeholder">{typeIcon(item.type)}</div>
        )}
        <button className="item-delete" onClick={onDelete} title="Remove">✕</button>
      </div>
      <div className="item-info">
        <p className="item-name">{item.name}</p>
        <p className="item-meta">
          {item.brand && <span>{item.brand}</span>}
          {colorDot && (
            <span className="item-color-dot" style={{ background: cssColor(colorDot) }} />
          )}
          <span className="item-type">{item.type}</span>
        </p>
        {item.occasion?.length > 0 && (
          <div className="item-tags">
            {item.occasion.slice(0, 3).map((o) => (
              <span key={o} className="item-tag">{o}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function typeIcon(type) {
  const icons = { top: "👕", bottom: "👖", shoes: "👟", outerwear: "🧥", dress: "👗", accessory: "🧢" };
  return icons[type] ?? "👔";
}

const CSS_COLORS = {
  black: "#1a1a1a", white: "#f0f0f0", grey: "#9e9e9e", navy: "#1e3a6e",
  blue: "#3b7dd8", red: "#d93025", green: "#2d8a4e", brown: "#8b5e3c",
  beige: "#d4b896", khaki: "#c3b091", pink: "#e91e8c", yellow: "#f5c518",
  orange: "#f57c00", purple: "#7b1fa2", burgundy: "#800020", coral: "#ff6b6b",
  olive: "#6b7c2e", teal: "#008080",
  multicolor: "linear-gradient(135deg, red, orange, yellow, green, blue, purple)",
};

function cssColor(name) {
  return CSS_COLORS[name?.toLowerCase()] ?? "#666";
}
