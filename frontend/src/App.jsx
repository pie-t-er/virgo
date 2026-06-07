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

  const onAgentAction = () => setRefreshKey((k) => k + 1);
  const onProfileSave = (p) => { setProfile(p); setShowSetup(false); };

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
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="header-spacer" />
      </header>

      {showSetup && <SetupModal onSave={onProfileSave} />}

      <main className="app-main">
        {activeTab === "chat" && <Chat onAgentAction={onAgentAction} />}
        {activeTab === "wardrobe" && <WardrobeGrid refreshKey={refreshKey} />}
        {activeTab === "calendar" && <CalendarView refreshKey={refreshKey} />}
        {activeTab === "settings" && (
          <Settings profile={profile} onSave={onProfileSave} />
        )}
      </main>
    </div>
  );
}

function SetupModal({ onSave }) {
  const [name, setName] = useState("");
  const [gender, setGender] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!gender) return;
    setSaving(true);
    const data = { name: name.trim(), gender };
    await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setSaving(false);
    onSave(data);
  }

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

        <button
          className="modal-save"
          onClick={handleSave}
          disabled={!gender || saving}
        >
          {saving ? "Saving…" : "Get started"}
        </button>
      </div>
    </div>
  );
}
