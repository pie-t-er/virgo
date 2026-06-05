import { useEffect, useState } from "react";
import { format, startOfWeek, addDays } from "date-fns";
import "./CalendarView.css";

export default function CalendarView({ refreshKey }) {
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  const weekEnd = addDays(weekStart, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  useEffect(() => {
    setLoading(true);
    const start = format(weekStart, "yyyy-MM-dd");
    const end = format(weekEnd, "yyyy-MM-dd");
    fetch(`/api/calendar?start=${start}&end=${end}`)
      .then((r) => r.json())
      .then((data) => { setEntries(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [weekStart, refreshKey]);

  function getEntry(day) {
    const dayStr = format(day, "yyyy-MM-dd");
    return entries.find(
      (e) => e.date && e.date.startsWith(dayStr)
    );
  }

  async function clearDay(date) {
    const dayStr = format(date, "yyyy-MM-dd");
    await fetch(`/api/calendar/${dayStr}`, { method: "DELETE" });
    setEntries((prev) => prev.filter((e) => !e.date?.startsWith(dayStr)));
  }

  return (
    <div className="calendar">
      <div className="calendar-header">
        <button className="week-nav" onClick={() => setWeekStart((d) => addDays(d, -7))}>‹</button>
        <span className="week-label">
          {format(weekStart, "MMM d")} – {format(weekEnd, "MMM d, yyyy")}
        </span>
        <button className="week-nav" onClick={() => setWeekStart((d) => addDays(d, 7))}>›</button>
      </div>

      {loading ? (
        <div className="calendar-empty">Loading…</div>
      ) : (
        <div className="calendar-grid">
          {days.map((day) => {
            const entry = getEntry(day);
            const isToday = format(day, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");
            return (
              <div key={day.toISOString()} className={`cal-day ${isToday ? "today" : ""}`}>
                <div className="cal-day-header">
                  <span className="cal-weekday">{format(day, "EEE")}</span>
                  <span className="cal-date">{format(day, "d")}</span>
                  {entry && (
                    <button
                      className="cal-clear"
                      onClick={() => clearDay(day)}
                      title="Clear outfit"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {entry ? (
                  <div className="cal-outfit">
                    {entry.occasion && (
                      <span className="cal-occasion">{entry.occasion}</span>
                    )}
                    <div className="cal-items">
                      {entry.items?.map((item) => (
                        <OutfitItem key={item._id} item={item} />
                      ))}
                    </div>
                    {entry.notes && <p className="cal-notes">{entry.notes}</p>}
                  </div>
                ) : (
                  <div className="cal-empty-day">
                    <span>No outfit planned</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="calendar-hint">
        Ask Virgo in the Chat tab to plan outfits for specific days.
      </p>
    </div>
  );
}

function OutfitItem({ item }) {
  const [imgErr, setImgErr] = useState(false);
  return (
    <div className="cal-item" title={item.name}>
      {item.image_url && !imgErr ? (
        <img src={item.image_url} alt={item.name} onError={() => setImgErr(true)} />
      ) : (
        <span className="cal-item-icon">{typeIcon(item.type)}</span>
      )}
    </div>
  );
}

function typeIcon(type) {
  const icons = { top: "👕", bottom: "👖", shoes: "👟", outerwear: "🧥", dress: "👗", accessory: "🧢" };
  return icons[type] ?? "👔";
}
