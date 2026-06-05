import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import "./Chat.css";

const SUGGESTIONS = [
  "What should I wear to a casual dinner tonight?",
  "Add a navy blue blazer, formal, for work and weddings",
  "Plan outfits for this week",
  "What's missing from my wardrobe?",
];

const INITIAL_MESSAGE = {
  role: "assistant",
  text: "Hi! I'm **Virgo**, your wardrobe assistant. I can recommend outfits, help you plan your week, or analyze what's missing from your closet.\n\nWhat can I help you with today?",
};

export default function Chat({ onAgentAction }) {
  const [messages, setMessages] = useState([INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeModel, setActiveModel] = useState("");
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function resetChat() {
    await fetch("/api/reset", { method: "POST" });
    setMessages([INITIAL_MESSAGE]);
    setInput("");
  }

  async function send(text) {
    const userText = text ?? input.trim();
    if (!userText || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: userText }]);
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
      setMessages((m) => [
        ...m,
        { role: "assistant", text: data.response, userText },
      ]);
      if (data.model) setActiveModel(data.model);
      onAgentAction?.();
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: "Sorry, I couldn't reach the server. Is the backend running?",
          userText,
        },
      ]);
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
          <div key={i} className={`msg msg-${msg.role}`}>
            {msg.role === "assistant" && (
              <div className="msg-avatar">♍</div>
            )}
            <div className="msg-bubble-wrap">
              <div className="msg-bubble">
                {msg.role === "assistant" ? (
                  <ReactMarkdown>{msg.text}</ReactMarkdown>
                ) : (
                  msg.text
                )}
              </div>
              {msg.role === "assistant" && msg.userText && (
                <button
                  className="retry-btn"
                  onClick={() => retry(msg.userText)}
                  disabled={loading}
                  title="Retry this message"
                >
                  ↺
                </button>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="msg msg-assistant">
            <div className="msg-avatar">♍</div>
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
          ref={textareaRef}
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
