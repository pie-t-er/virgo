import { useState } from "react";
import "./Settings.css";

export default function Settings({ profile, onSave }) {
  const [name, setName] = useState(profile?.name || "");
  const [gender, setGender] = useState(profile?.gender || "");
  const [location, setLocation] = useState(profile?.location || "");
  const [tempUnit, setTempUnit] = useState(profile?.temp_unit || "F");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function handleDemoReset() {
    if (!window.confirm("Reset demo? This clears the profile so onboarding runs again on next load.")) return;
    setResetting(true);
    await fetch("/api/demo/reset", { method: "POST" });
    sessionStorage.removeItem("virgo_entered");
    setResetting(false);
    window.location.reload();
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    const data = { name: name.trim(), gender, location: location.trim(), temp_unit: tempUnit };
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
          <label>Location</label>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Tampa, FL"
          />
          <p className="settings-note">
            Used by Virgo to check weather forecasts when planning outfits.
          </p>
        </div>

        <div className="settings-field">
          <label>Temperature unit</label>
          <div className="gender-options">
            {["F", "C"].map((u) => (
              <button
                key={u}
                className={`gender-btn ${tempUnit === u ? "active" : ""}`}
                onClick={() => setTempUnit(u)}
              >
                °{u}
              </button>
            ))}
          </div>
          <p className="settings-note">Used when adding items and displaying temperature comfort ranges.</p>
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

      <div className="settings-card settings-card--danger">
        <h2>Demo</h2>
        <p className="settings-hint">
          Resets the profile so the onboarding flow runs again on next load.
          Bookmark <code>?fresh=1</code> to trigger this automatically.
        </p>
        <button
          className="settings-reset-btn"
          onClick={handleDemoReset}
          disabled={resetting}
        >
          {resetting ? "Resetting…" : "Reset demo"}
        </button>
      </div>
    </div>
  );
}
