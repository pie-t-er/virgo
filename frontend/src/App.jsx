import { useEffect, useState } from "react";
import Chat from "./components/Chat.jsx";
import WardrobeGrid from "./components/WardrobeGrid.jsx";
import CalendarView from "./components/CalendarView.jsx";
import Settings from "./components/Settings.jsx";
import Landing from "./components/Landing.jsx";
import logo from "./virgo_logo.png";
import "./App.css";

const TABS = [
  { id: "chat", label: "✦ Chat" },
  { id: "wardrobe", label: "Wardrobe" },
  { id: "calendar", label: "Calendar" },
  { id: "settings", label: "Settings" },
];

export default function App() {
  const [showLanding, setShowLanding] = useState(
    () => !sessionStorage.getItem("virgo_entered")
  );
  const [activeTab, setActiveTab] = useState("chat");
  const [refreshKey, setRefreshKey] = useState(0);
  const [profile, setProfile] = useState(null);
  const [showSetup, setShowSetup] = useState(false);

  // ?fresh=1 → wipe demo state so onboarding reruns
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("fresh") === "1") {
      sessionStorage.removeItem("virgo_entered");
      fetch("/api/demo/reset", { method: "POST" }).finally(() => {
        window.history.replaceState({}, "", window.location.pathname);
        window.location.reload();
      });
    }
  }, []);

  // All hooks must be declared before any conditional returns
  useEffect(() => {
    if (showLanding) return;
    fetch("/api/profile")
      .then((r) => r.json())
      .then((p) => {
        setProfile(p);
        if (!p.gender) setShowSetup(true);
      })
      .catch(() => setShowSetup(true));
  }, [showLanding]);

  function enterApp() {
    sessionStorage.setItem("virgo_entered", "1");
    setShowLanding(false);
  }

  function goHome() {
    setShowLanding(true);
  }

  const [chatPrefill, setChatPrefill] = useState("");
  const [chatCarryItems, setChatCarryItems] = useState([]);
  const [chatResetKey, setChatResetKey] = useState(0);
  const onAgentAction = () => setRefreshKey((k) => k + 1);
  const onProfileSave = (p) => { setProfile(p); setShowSetup(false); };

  function goToChat(prefill, carryItems = []) {
    setChatPrefill(prefill);
    setChatCarryItems(carryItems);
    setActiveTab("chat");
  }

  useEffect(() => {
    const handler = (e) => {
      if (typeof e.detail === "string") {
        goToChat(e.detail);
      } else {
        goToChat(e.detail.text, e.detail.carryItems || []);
      }
    };
    window.addEventListener("virgo:prefill-chat", handler);
    return () => window.removeEventListener("virgo:prefill-chat", handler);
  }, []);

  if (showLanding) {
    return <Landing onEnter={enterApp} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <div
          className="logo"
          onClick={goHome}
          style={{ cursor: "pointer" }}
          title="Back to home"
        >
          <img src={logo} alt="Virgo" className="header-logo-img" />
          <span className="logo-text">Virgo</span>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab-btn ${activeTab === t.id ? "active" : ""}`}
              onClick={() => {
                if (t.id === "chat" && activeTab === "chat") {
                  // Re-clicking Chat tab resets the conversation
                  fetch("/api/reset", { method: "POST" });
                  setChatResetKey((k) => k + 1);
                } else {
                  setActiveTab(t.id);
                }
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="header-spacer" />
      </header>

      {showSetup && <SetupModal onSave={onProfileSave} />}

      <main className="app-main">
        {activeTab === "chat" && <Chat key={chatResetKey} onAgentAction={onAgentAction} prefill={chatPrefill} onPrefillConsumed={() => setChatPrefill("")} carryItems={chatCarryItems} onCarryConsumed={() => setChatCarryItems([])} />}
        {activeTab === "wardrobe" && <WardrobeGrid refreshKey={refreshKey} />}
        {activeTab === "calendar" && <CalendarView refreshKey={refreshKey} onPlanDay={goToChat} />}
        {activeTab === "settings" && (
          <Settings profile={profile} onSave={onProfileSave} />
        )}
      </main>
    </div>
  );
}

function SetupModal({ onSave }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [gender, setGender] = useState("");
  const [location, setLocation] = useState("");
  const [tempUnit, setTempUnit] = useState("F");
  const [saving, setSaving] = useState(false);
  const [photos, setPhotos] = useState([]); // base64 strings
  const [photoUploading, setPhotoUploading] = useState(false);

  async function handleProfileSave() {
    if (!gender) return;
    setSaving(true);
    const data = { name: name.trim(), gender, location: location.trim(), temp_unit: tempUnit };
    await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setSaving(false);
    setStep(2);
  }

  async function handlePhotoFiles(e) {
    const files = Array.from(e.target.files).slice(0, 3);
    setPhotoUploading(true);
    const results = await Promise.all(
      files.map(
        (f) =>
          new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (ev) => {
              // Strip data URL prefix, keep only base64 payload
              const b64 = ev.target.result.split(",")[1];
              resolve(b64);
            };
            reader.readAsDataURL(f);
          })
      )
    );
    setPhotos(results);
    setPhotoUploading(false);
  }

  async function handleFinish(skipPhotos = false) {
    if (!skipPhotos && photos.length > 0) {
      await fetch("/api/profile/photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photos }),
      });
    }
    onSave({ name: name.trim(), gender, location: location.trim(), temp_unit: tempUnit });
  }

  if (step === 1) {
    return (
      <div className="modal-overlay">
        <div className="modal">
          <img src={logo} alt="Virgo" className="modal-logo-img" />
          <h2>Welcome to Virgo</h2>
          <p>Let's personalise your wardrobe experience.</p>

          <div className="modal-field">
            <label>Your name (optional)</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alex"
            />
          </div>

          <div className="modal-field">
            <label>I wear</label>
            <div className="gender-options">
              {["men", "women"].map((g) => (
                <button
                  key={g}
                  className={`gender-btn ${gender === g ? "active" : ""}`}
                  onClick={() => setGender(g)}
                >
                  {g === "men" ? "Men's clothing" : "Women's clothing"}
                </button>
              ))}
            </div>
          </div>

          <div className="modal-field">
            <label>Your city (optional)</label>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Tampa, FL"
            />
          </div>

          <div className="modal-field">
            <label>Temperature preference</label>
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
          </div>

          <button
            className="modal-save"
            onClick={handleProfileSave}
            disabled={!gender || saving}
          >
            {saving ? "Saving…" : "Next →"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <img src={logo} alt="Virgo" className="modal-logo-img" />
        <h2>Add reference photos</h2>
        <p style={{ fontSize: "0.88rem", color: "var(--text2)", lineHeight: 1.5 }}>
          Optional: upload 1–3 full-body photos of yourself. Virgo uses them
          to generate personalized outfit visualizations.
        </p>

        <div className="modal-field">
          <label htmlFor="photo-upload" className="photo-upload-label">
            {photoUploading
              ? "Reading photos…"
              : photos.length > 0
              ? `${photos.length} photo${photos.length > 1 ? "s" : ""} selected ✓`
              : "Choose photos (up to 3)"}
          </label>
          <input
            id="photo-upload"
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={handlePhotoFiles}
          />
        </div>

        <div className="modal-btn-row">
          <button
            className="modal-skip"
            onClick={() => handleFinish(true)}
          >
            Skip
          </button>
          <button
            className="modal-save"
            onClick={() => handleFinish(false)}
            disabled={photoUploading}
          >
            {photos.length > 0 ? "Save & start" : "Start without photos"}
          </button>
        </div>
      </div>
    </div>
  );
}
