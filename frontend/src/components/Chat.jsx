import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import logo from "../virgo_logo.png";
import OutfitPanel from "./OutfitPanel.jsx";
import "./Chat.css";

const SUGGESTIONS = [
  "What should I wear to a casual dinner tonight?",
  "Plan outfits for my whole week",
  "What's missing from my wardrobe?",
  "Show me something for a formal occasion",
];

const INITIAL_MESSAGE = {
  role: "assistant",
  text: "Hi! I'm **Virgo**, your AI wardrobe assistant. I can recommend outfits from your wardrobe, plan your week, and find gaps in your closet.\n\nWhat can I help you with today?",
  items: [],
};


export default function Chat({ onAgentAction }) {
  const [messages, setMessages] = useState([INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeModel, setActiveModel] = useState("");
  const [copied, setCopied] = useState(null); // index of copied message
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function resetChat() {
    await fetch("/api/reset", { method: "POST" });
    setMessages([INITIAL_MESSAGE]);
    setInput("");
  }

  async function send(text) {
    const userText = (text ?? input).trim();
    if (!userText || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: userText, items: [] }]);
    setLoading(true);
    await _doSend(userText);
  }

  async function retry(userText) {
    if (loading) return;
    setLoading(true);
    await _doSend(userText);
  }

  async function _doSend(userText) {
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText }),
      });
      const data = await res.json();
      setMessages((m) => [...m, {
        role: "assistant",
        text: data.response,
        items: data.items || [],
        candidates: data.candidates || {},
        userText,
      }]);
      if (data.model) setActiveModel(data.model);
      onAgentAction?.();
    } catch {
      setMessages((m) => [...m, {
        role: "assistant",
        text: "Sorry, I couldn't reach the server. Is the backend running?",
        items: [],
        userText,
      }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function copyMessage(text, idx) {
    navigator.clipboard.writeText(text);
    setCopied(idx);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="chat">
      <div className="chat-toolbar">
        {activeModel && (
          <span className="model-badge">{activeModel.replace("models/", "")}</span>
        )}
        <button className="reset-btn" onClick={resetChat} disabled={loading}>
          ↺ New chat
        </button>
      </div>

      <div className="chat-messages">
        {messages.map((msg, i) => (
          <div key={i} className={`msg msg-${msg.role} msg-appear`}>
            {msg.role === "assistant" && (
              <div className="msg-avatar">
                <img src={logo} alt="Virgo" />
              </div>
            )}
            <div className="msg-bubble-wrap">
              <div className="msg-bubble">
                {msg.role === "assistant" ? (
                  <ReactMarkdown>{msg.text}</ReactMarkdown>
                ) : (
                  msg.text
                )}

                {/* Outfit panel with accept/swap */}
                {msg.items?.length > 0 && (
                  <OutfitPanel
                    items={msg.items}
                    candidates={msg.candidates || {}}
                  />
                )}
              </div>

              {/* Message actions */}
              {msg.role === "assistant" && (
                <div className="msg-actions">
                  <button
                    className="msg-action-btn"
                    onClick={() => copyMessage(msg.text, i)}
                    title="Copy"
                  >
                    {copied === i ? "✓" : "⎘"}
                  </button>
                  {msg.userText && (
                    <button
                      className="msg-action-btn"
                      onClick={() => retry(msg.userText)}
                      disabled={loading}
                      title="Retry"
                    >
                      ↺
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="msg msg-assistant msg-appear">
            <div className="msg-avatar">
              <img src={logo} alt="Virgo" />
            </div>
            <div className="msg-bubble-wrap">
              <div className="msg-bubble">
                <span className="typing-dots">
                  <span /><span /><span />
                </span>
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {messages.length === 1 && (
        <div className="suggestions">
          {SUGGESTIONS.map((s, i) => (
            <button key={i} className="suggestion-chip" onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="chat-input-row">
        <textarea
          className="chat-input"
          placeholder="Ask Virgo anything about your wardrobe…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <button
          className="send-btn"
          onClick={() => send()}
          disabled={!input.trim() || loading}
        >
          ↑
        </button>
      </div>
    </div>
  );
}
