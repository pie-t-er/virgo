import { useState } from "react";
import "./Settings.css";

export default function Settings({ profile, onSave }) {
  const [name, setName] = useState(profile?.name || "");
  const [gender, setGender] = useState(profile?.gender || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    const data = { name: name.trim(), gender };
    await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setSaving(false);
    setSaved(true);
    onSave?.(data);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="settings">
      <div className="settings-card">
        <h2>Profile</h2>
        <p className="settings-hint">
          These preferences are stored in your wardrobe database and shape every
          outfit recommendation Virgo makes.
        </p>

        <div className="settings-field">
          <label>Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name (optional)"
          />
        </div>

        <div className="settings-field">
          <label>Clothing preference</label>
          <div className="gender-options">
            {["men", "women"].map((g) => (
              <button
                key={g}
                className={`gender-btn ${gender === g ? "active" : ""}`}
                onClick={() => setGender(g)}
              >
                {g === "men" ? "👔 Men's" : "👗 Women's"}
              </button>
            ))}
          </div>
          <p className="settings-note">
            Virgo will only suggest items matching your preference when building outfits.
          </p>
        </div>

        <button
          className="settings-save"
          onClick={handleSave}
          disabled={!gender || saving}
        >
          {saving ? "Saving…" : saved ? "✓ Saved" : "Save changes"}
        </button>

        {saved && (
          <p className="settings-confirm">
            Profile updated — chat context has been reset so Virgo picks up your new preferences immediately.
          </p>
        )}
      </div>
    </div>
  );
}
