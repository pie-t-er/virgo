import { useEffect, useRef, useState, useCallback } from "react";
import "./WardrobeGrid.css";

const ALL_TYPE_FILTERS = ["all", "top", "bottom", "shoes", "outerwear", "dress", "accessory"];
const MEN_TYPE_FILTERS  = ALL_TYPE_FILTERS.filter((t) => t !== "dress");

const TYPE_OPTIONS  = ["top", "bottom", "shoes", "outerwear", "dress", "accessory"];

// Preset style tags
const PRESET_TAGS = [
  "casual", "work", "formal", "party", "outdoor", "beach", "sporty",
];

// Temperature presets — { label, tempMin, tempMax } in °F; °C shown when toggled
const TEMP_PRESETS_F = [
  { id: "cold",   label: "Cold",   sub: "below 65°F", tempMin: null, tempMax: 65 },
  { id: "mild",   label: "Mild",   sub: "55 – 75°F",  tempMin: 55,   tempMax: 75 },
  { id: "warm",   label: "Warm",   sub: "above 75°F", tempMin: 75,   tempMax: null },
  { id: "custom", label: "Custom", sub: "set a range", tempMin: null, tempMax: null },
];
const TEMP_PRESETS_C = [
  { id: "cold",   label: "Cold",   sub: "below 15°C", tempMin: null, tempMax: 15 },
  { id: "mild",   label: "Mild",   sub: "15 – 25°C",  tempMin: 15,   tempMax: 25 },
  { id: "warm",   label: "Warm",   sub: "above 25°C", tempMin: 25,   tempMax: null },
  { id: "custom", label: "Custom", sub: "set a range", tempMin: null, tempMax: null },
];

// ── Image compression helper ──────────────────────────────
async function compressImage(file, maxWidth = 900) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.src = url;
  });
}

// ── Main component ────────────────────────────────────────
export default function WardrobeGrid({ refreshKey }) {
  const [items, setItems]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch]     = useState("");
  const [gender, setGender]     = useState(null);
  const [tempUnit, setTempUnit] = useState("F");
  const [showAdd, setShowAdd]   = useState(false);
  const [detailItem, setDetailItem] = useState(null);
  const [editItem, setEditItem] = useState(null);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((p) => { setGender(p.gender || ""); setTempUnit(p.temp_unit || "F"); })
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
        it.brand?.toLowerCase().includes(search.toLowerCase())
      )
    : items;

  async function deleteItem(id) {
    await fetch(`/api/wardrobe/${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((it) => it._id !== id));
    if (detailItem?._id === id) setDetailItem(null);
  }

  async function handleAdd(formData) {
    const body = {
      name: formData.name,
      type: formData.type,
      brand: formData.brand,
      tags: formData.tags,
      temp_min: formData.tempMin !== "" ? parseInt(formData.tempMin, 10) : null,
      temp_max: formData.tempMax !== "" ? parseInt(formData.tempMax, 10) : null,
      image_url: formData.imageDataUrl || "",
    };
    const res = await fetch("/api/wardrobe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      setShowAdd(false);
      const params = new URLSearchParams();
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (gender) params.set("gender", gender);
      fetch(`/api/wardrobe?${params}`)
        .then((r) => r.json())
        .then(setItems);
    }
  }

  async function handleEdit(formData) {
    const body = {
      name: formData.name,
      type: formData.type,
      brand: formData.brand,
      tags: formData.tags,
      temp_min: formData.tempMin !== "" ? parseInt(formData.tempMin, 10) : null,
      temp_max: formData.tempMax !== "" ? parseInt(formData.tempMax, 10) : null,
      image_url: formData.imageDataUrl || "",
    };
    const res = await fetch(`/api/wardrobe/${editItem._id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      setEditItem(null);
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
          placeholder="Search by name or brand…"
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
            <ItemCard
              key={item._id}
              item={item}
              onDelete={() => deleteItem(item._id)}
              onDetail={() => setDetailItem(item)}
            />
          ))}
        </div>
      )}

      {(showAdd || editItem) && (
        <AddItemModal
          gender={gender}
          tempUnit={tempUnit}
          editItem={editItem}
          onSave={editItem ? handleEdit : handleAdd}
          onClose={() => { setShowAdd(false); setEditItem(null); }}
        />
      )}

      {detailItem && (
        <ItemDetailModal
          item={detailItem}
          onClose={() => setDetailItem(null)}
          onDelete={() => deleteItem(detailItem._id)}
          onEdit={() => { setEditItem(detailItem); setDetailItem(null); }}
          onBuildOutfit={(item, prompt) => {
            setDetailItem(null);
            // Carry the anchor item so the outfit panel always includes it,
            // even if the agent doesn't surface it from a tool result.
            window.dispatchEvent(new CustomEvent("virgo:prefill-chat", {
              detail: { text: prompt, carryItems: [item] },
            }));
          }}
        />
      )}
    </div>
  );
}

// ── Item card ─────────────────────────────────────────────
function ItemCard({ item, onDelete, onDetail }) {
  const [imgErr, setImgErr] = useState(false);

  return (
    <div className="item-card" onClick={onDetail}>
      <div className="item-img-wrap">
        {item.image_url && !imgErr ? (
          <img src={item.image_url} alt={item.name} onError={() => setImgErr(true)} loading="lazy" />
        ) : (
          <div className="item-img-placeholder">{typeIcon(item.type)}</div>
        )}
        <button
          className="item-delete"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Remove"
        >✕</button>
      </div>
      <div className="item-info">
        <p className="item-name">{item.name}</p>
        <p className="item-meta">
          {item.brand && <span>{item.brand}</span>}
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

// ── Item detail modal ─────────────────────────────────────
function ItemDetailModal({ item, onClose, onDelete, onEdit, onBuildOutfit }) {
  const [imgErr, setImgErr] = useState(false);
  const allTags = [
    ...(item.occasion || []),
    ...(item.season   || []),
    ...(item.tags     || []).filter(
      (t) => !["men","women"].includes(t) &&
             !(item.occasion || []).includes(t) &&
             !(item.season   || []).includes(t)
    ),
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="item-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="item-detail-header">
          <div>
            <h2 className="item-detail-name">{item.name}</h2>
            {item.brand && <p className="item-detail-brand">{item.brand}</p>}
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="item-detail-body">
          <div className="item-detail-img-wrap">
            {item.image_url && !imgErr ? (
              <img src={item.image_url} alt={item.name} onError={() => setImgErr(true)} />
            ) : (
              <div className="item-detail-placeholder">{typeIcon(item.type)}</div>
            )}
          </div>

          <div className="item-detail-info">
            <DetailRow label="Type" value={item.type} capitalize />
            {allTags.length > 0 && (
              <div className="item-detail-row">
                <span className="item-detail-label">Style</span>
                <div className="item-detail-pills">
                  {allTags.map((t) => (
                    <span key={t} className="item-tag">{t}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="item-detail-footer">
          <div className="item-detail-footer-left">
            <button className="btn-edit" onClick={onEdit}>
              ✎ Edit
            </button>
            <button className="btn-cancel" onClick={() => { onDelete(); onClose(); }}>
              🗑 Remove
            </button>
          </div>
          <button
            className="btn-save"
            onClick={() => onBuildOutfit(item, `Build an outfit around my ${item.name}${item.brand ? ` by ${item.brand}` : ""}`)}
          >
            ✦ Build an outfit
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, capitalize }) {
  if (!value) return null;
  return (
    <div className="item-detail-row">
      <span className="item-detail-label">{label}</span>
      <span className={`item-detail-value${capitalize ? " capitalize" : ""}`}>{value}</span>
    </div>
  );
}

// Stored temp_min/temp_max are always °F — convert back to the display unit when editing
function fToDisplayUnit(value, unit) {
  if (value == null) return "";
  return String(unit === "C" ? Math.round((value - 32) * 5 / 9) : value);
}

// ── Add / Edit item modal ──────────────────────────────────
function AddItemModal({ gender, tempUnit, editItem, onSave, onClose }) {
  const TEMP_PRESETS = tempUnit === "C" ? TEMP_PRESETS_C : TEMP_PRESETS_F;
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() =>
    editItem
      ? {
          name: editItem.name || "",
          type: editItem.type || "top",
          brand: editItem.brand || "",
          tags: editItem.occasion || [],
          tempPreset: editItem.temp_min != null || editItem.temp_max != null ? "custom" : "",
          tempMin: fToDisplayUnit(editItem.temp_min, tempUnit),
          tempMax: fToDisplayUnit(editItem.temp_max, tempUnit),
          imageDataUrl: editItem.image_url || "",
        }
      : {
          name: "", type: "top", brand: "",
          tags: [], tempPreset: "", tempMin: "", tempMax: "",
          imageDataUrl: "",
        }
  );
  const [imgPreview, setImgPreview] = useState(editItem?.image_url || null);
  const [customTag, setCustomTag] = useState("");
  const fileRef = useRef(null);

  function selectTempPreset(preset) {
    if (preset.id === "custom") {
      setForm((f) => ({ ...f, tempPreset: "custom", tempMin: "", tempMax: "" }));
    } else {
      // Convert preset values to °F for storage (backend always stores °F)
      let min = preset.tempMin, max = preset.tempMax;
      if (tempUnit === "C") {
        if (min != null) min = Math.round(min * 9 / 5 + 32);
        if (max != null) max = Math.round(max * 9 / 5 + 32);
      }
      setForm((f) => ({ ...f, tempPreset: preset.id, tempMin: min ?? "", tempMax: max ?? "" }));
    }
  }

  function toggleTag(value) {
    setForm((f) => ({
      ...f,
      tags: f.tags.includes(value)
        ? f.tags.filter((t) => t !== value)
        : [...f.tags, value],
    }));
  }

  function addCustomTag() {
    const t = customTag.trim().toLowerCase();
    if (!t || form.tags.includes(t)) return;
    setForm((f) => ({ ...f, tags: [...f.tags, t] }));
    setCustomTag("");
  }

  function removeTag(t) {
    setForm((f) => ({ ...f, tags: f.tags.filter((x) => x !== t) }));
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await compressImage(file);
    setImgPreview(dataUrl);
    setForm((f) => ({ ...f, imageDataUrl: dataUrl }));
  }

  async function handleSave() {
    if (!form.name || !form.type) return;
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
          <h2>{editItem ? "Edit clothing item" : "Add clothing item"}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="add-modal-body">
          {/* Image upload */}
          <div className="add-field">
            <label>Photo</label>
            <div
              className="img-upload-zone"
              onClick={() => fileRef.current?.click()}
            >
              {imgPreview ? (
                <img src={imgPreview} alt="preview" className="img-upload-preview" />
              ) : (
                <span className="img-upload-hint">Click to upload a photo</span>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
          </div>

          {/* Name */}
          <div className="add-field">
            <label>Name *</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. White Oxford Shirt"
            />
          </div>

          {/* Type */}
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

          {/* Brand */}
          <div className="add-field">
            <label>Brand</label>
            <input
              value={form.brand}
              onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
              placeholder="e.g. Uniqlo"
            />
          </div>

          {/* Style tags */}
          <div className="add-field">
            <label>Style</label>
            <div className="pill-group" style={{ marginBottom: 8 }}>
              {PRESET_TAGS.map((t) => (
                <button
                  key={t}
                  className={`pill ${form.tags.includes(t) ? "active" : ""}`}
                  onClick={() => toggleTag(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            {/* Custom tag input */}
            <div className="custom-tag-row">
              <input
                className="custom-tag-input"
                placeholder="Add custom tag…"
                value={customTag}
                onChange={(e) => setCustomTag(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addCustomTag()}
              />
              <button className="custom-tag-add" onClick={addCustomTag}>+</button>
            </div>
            {/* Selected tags */}
            {form.tags.length > 0 && (
              <div className="selected-tags">
                {form.tags.map((t) => (
                  <span key={t} className="selected-tag">
                    {t}
                    <button onClick={() => removeTag(t)}>✕</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Temperature comfort */}
          <div className="add-field">
            <label>Climate</label>
            <div className="pill-group" style={{ marginBottom: form.tempPreset === "custom" ? 8 : 0 }}>
              {TEMP_PRESETS.map((p) => (
                <button
                  key={p.id}
                  className={`pill temp-pill ${form.tempPreset === p.id ? "active" : ""}`}
                  onClick={() => selectTempPreset(p)}
                >
                  {p.label}
                  {p.sub && <span className="temp-pill-sub">{p.sub}</span>}
                </button>
              ))}
            </div>
            {form.tempPreset === "custom" && (
              <div className="temp-range-row">
                <input
                  type="number"
                  className="temp-input"
                  placeholder="Min"
                  value={form.tempMin}
                  onChange={(e) => setForm((f) => ({ ...f, tempMin: e.target.value }))}
                />
                <span className="temp-dash">–</span>
                <input
                  type="number"
                  className="temp-input"
                  placeholder="Max"
                  value={form.tempMax}
                  onChange={(e) => setForm((f) => ({ ...f, tempMax: e.target.value }))}
                />
                <span className="temp-unit">°{tempUnit}</span>
              </div>
            )}
          </div>
        </div>

        <div className="add-modal-footer">
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button
            className="btn-save"
            onClick={handleSave}
            disabled={!form.name || saving}
          >
            {editItem
              ? (saving ? "Saving…" : "Save changes")
              : (saving ? "Adding…" : "Add to wardrobe")}
          </button>
        </div>
      </div>
    </div>
  );
}

function typeIcon(type) {
  const icons = { top: "👕", bottom: "👖", shoes: "👟", outerwear: "🧥", dress: "👗", accessory: "🧢" };
  return icons[type] ?? "👔";
}
