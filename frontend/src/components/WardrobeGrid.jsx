import { useEffect, useState } from "react";
import "./WardrobeGrid.css";

const ALL_TYPE_FILTERS = ["all", "top", "bottom", "shoes", "outerwear", "dress", "accessory"];
const MEN_TYPE_FILTERS = ALL_TYPE_FILTERS.filter((t) => t !== "dress");

export default function WardrobeGrid({ refreshKey }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [gender, setGender] = useState(null); // null = profile not yet loaded

  // Load gender preference once; wardrobe fetch waits for this
  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((p) => setGender(p.gender || ""))
      .catch(() => setGender(""));
  }, [refreshKey]);

  useEffect(() => {
    if (gender === null) return; // wait until profile is known
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
    ? items.filter(
        (it) =>
          it.name?.toLowerCase().includes(search.toLowerCase()) ||
          it.brand?.toLowerCase().includes(search.toLowerCase()) ||
          it.color?.join(" ").toLowerCase().includes(search.toLowerCase())
      )
    : items;

  async function deleteItem(id) {
    await fetch(`/api/wardrobe/${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((it) => it._id !== id));
  }

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
          {(gender === "men" ? MEN_TYPE_FILTERS : ALL_TYPE_FILTERS).map((t) => (
            <button
              key={t}
              className={`type-chip ${typeFilter === t ? "active" : ""}`}
              onClick={() => setTypeFilter(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="wardrobe-empty">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="wardrobe-empty">
          No items yet. Ask Virgo to add some clothes!
        </div>
      ) : (
        <div className="wardrobe-grid">
          {filtered.map((item) => (
            <ItemCard key={item._id} item={item} onDelete={() => deleteItem(item._id)} />
          ))}
        </div>
      )}
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
          <img
            src={item.image_url}
            alt={item.name}
            onError={() => setImgErr(true)}
            loading="lazy"
          />
        ) : (
          <div className="item-img-placeholder">
            {typeIcon(item.type)}
          </div>
        )}
        <button className="item-delete" onClick={onDelete} title="Remove">✕</button>
      </div>
      <div className="item-info">
        <p className="item-name">{item.name}</p>
        <p className="item-meta">
          {item.brand && <span>{item.brand}</span>}
          {colorDot && <span className="item-color-dot" style={{ background: cssColor(colorDot) }} />}
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
  const icons = {
    top: "👕", bottom: "👖", shoes: "👟", outerwear: "🧥",
    dress: "👗", accessory: "🧢",
  };
  return icons[type] ?? "👔";
}

function cssColor(name) {
  const map = {
    black: "#1a1a1a", white: "#f5f5f5", navy: "#1e3a6e", blue: "#3b7dd8",
    red: "#d93025", green: "#2d8a4e", grey: "#9e9e9e", gray: "#9e9e9e",
    beige: "#d4b896", brown: "#8b5e3c", pink: "#e91e8c", yellow: "#f5c518",
    orange: "#f57c00", purple: "#7b1fa2", burgundy: "#800020", ivory: "#fffff0",
    rust: "#b7410e", multicolor: "conic-gradient(red,yellow,green,blue,red)",
  };
  return map[name?.toLowerCase()] ?? "#666";
}
