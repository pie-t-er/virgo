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
  const [name, setName] = useState("");
  const [gender, setGender] = useState("");
  const [location, setLocation] = useState("");
  const [tempUnit, setTempUnit] = useState("F");
  const [saving, setSaving] = useState(false);

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
          {saving ? "Saving…" : "Start"}
        </button>
      </div>
    </div>
  );
}
