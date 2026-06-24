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


export default function Chat({ onAgentAction, prefill, onPrefillConsumed, carryItems = [], onCarryConsumed }) {
  const [messages, setMessages] = useState([INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeModel, setActiveModel] = useState("");
  const [copied, setCopied] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // When a prefill arrives, set input, focus, and select-all so user can type immediately
  useEffect(() => {
    if (prefill) {
      setInput(prefill);
      onPrefillConsumed?.();
      setTimeout(() => {
        const el = inputRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      }, 50);
    }
  }, [prefill]);

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

  // For buttons that live inside the chat page itself (e.g. the OutfitPanel's
  // accessory prompt) — sends immediately rather than dropping a draft into
  // the input box, since there's nothing here for the user to review/edit.
  async function sendDirect(text, items = []) {
    if (!text || loading) return;
    setMessages((m) => [...m, { role: "user", text, items: [] }]);
    setLoading(true);
    await _doSend(text, items);
  }

  async function retry(userText) {
    if (loading) return;
    setLoading(true);
    await _doSend(userText);
  }

  async function _doSend(userText, carryOverride) {
    const effectiveCarry = carryOverride !== undefined ? carryOverride : carryItems;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText }),
      });
      const data = await res.json();
      // If carry items exist (e.g. from the accessory prompt), prepend them
      // so the OutfitPanel shows the full outfit + the new accessories together.
      const newItems = data.items || [];
      const newCandidates = data.candidates || {};
      let mergedItems = newItems;
      let mergedCandidates = newCandidates;
      if (effectiveCarry.length > 0) {
        const carryIds = new Set(effectiveCarry.map((i) => i._id));
        mergedItems = [
          ...effectiveCarry,
          ...newItems.filter((i) => !carryIds.has(i._id)),
        ];
        const carryCandidates = effectiveCarry.reduce(
          (acc, item) => ({ ...acc, [item.type]: [item] }),
          {}
        );
        mergedCandidates = { ...carryCandidates, ...newCandidates };
        if (carryOverride === undefined) onCarryConsumed?.();
      }
      setMessages((m) => [...m, {
        role: "assistant",
        text: data.response,
        items: mergedItems,
        candidates: mergedCandidates,
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
                    onAccessorize={sendDirect}
                    busy={loading}
                  />
                )}

                {/* Actions inside the bubble */}
                {msg.role === "assistant" && (
                  <div className="msg-actions">
                    {i > 0 && (
                    <button
                      className="msg-action-btn"
                      onClick={() => copyMessage(msg.text, i)}
                      title="Copy"
                    >
                      {copied === i ? "✓" : "⎘"}
                    </button>
                    )}
                    {i > 0 && msg.userText && (
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
          ref={inputRef}
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
