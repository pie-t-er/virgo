import { useEffect, useState } from "react";
import { format, startOfWeek, addDays } from "date-fns";
import "./CalendarView.css";

export default function CalendarView({ refreshKey, onPlanDay }) {
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );
  const [entriesByDate, setEntriesByDate] = useState({});
  const [loading, setLoading] = useState(true);

  const weekEnd = addDays(weekStart, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  useEffect(() => {
    setLoading(true);
    const start = format(weekStart, "yyyy-MM-dd");
    const end = format(weekEnd, "yyyy-MM-dd");
    fetch(`/api/calendar?start=${start}&end=${end}`)
      .then((r) => r.json())
      .then((data) => {
        // Group multiple outfits per date string
        const grouped = {};
        for (const entry of data) {
          const key = entry.date?.slice(0, 10);
          if (!key) continue;
          if (!grouped[key]) grouped[key] = [];
          grouped[key].push(entry);
        }
        setEntriesByDate(grouped);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [weekStart, refreshKey]);

  async function clearEntry(dayStr, entryId) {
    await fetch(`/api/calendar/entry/${entryId}`, { method: "DELETE" });
    setEntriesByDate((prev) => {
      const updated = (prev[dayStr] || []).filter((e) => e._id !== entryId);
      if (updated.length === 0) {
        const next = { ...prev };
        delete next[dayStr];
        return next;
      }
      return { ...prev, [dayStr]: updated };
    });
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
            const dayStr = format(day, "yyyy-MM-dd");
            const outfits = entriesByDate[dayStr] || [];
            const isToday = dayStr === format(new Date(), "yyyy-MM-dd");
            return (
              <DayCell
                key={dayStr}
                day={day}
                dayStr={dayStr}
                isToday={isToday}
                outfits={outfits}
                onClearEntry={(entryId) => clearEntry(dayStr, entryId)}
                onPlanDay={onPlanDay}
              />
            );
          })}
        </div>
      )}

    </div>
  );
}

function DayCell({ day, dayStr, isToday, outfits, onClearEntry, onPlanDay }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => { setIdx(0); }, [outfits.length]);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const isPast = day < today;

  const outfit = outfits[idx] ?? null;

  return (
    <div className={`cal-day ${isToday ? "today" : ""}`}>
      <div className="cal-day-header">
        <span className="cal-weekday">{format(day, "EEE")}</span>
        <span className="cal-date">{format(day, "d")}</span>
        {outfit && (
          <button className="cal-clear" onClick={() => onClearEntry(outfit._id)} title="Remove this outfit">✕</button>
        )}
      </div>

      {!outfit && onPlanDay && !isPast && (
        <button
          className="cal-plan-btn"
          onClick={() => onPlanDay(`Plan an outfit for ${format(day, "EEEE, MMMM d")}`)}
          title="Plan outfit for this day"
        >✦</button>
      )}

      {outfit ? (
        <div className="cal-outfit">
          {outfit.occasion && (
            <span className="cal-occasion">{outfit.occasion}</span>
          )}

          <div className="cal-items-grid">
            {[...(outfit.items || [])]
              .sort((a, b) => (a.type === "accessory" ? -1 : b.type === "accessory" ? 1 : 0))
              .map((item) => (
                <CalItem key={item._id} item={item} />
              ))}
          </div>

          {outfit.notes && <p className="cal-notes">{outfit.notes}</p>}

          {/* Slider controls for multiple outfits */}
          {outfits.length > 1 && (
            <div className="cal-slider">
              <button
                className="cal-slider-arrow"
                onClick={() => setIdx((i) => (i - 1 + outfits.length) % outfits.length)}
              >‹</button>
              <div className="cal-slider-dots">
                {outfits.map((_, i) => (
                  <button
                    key={i}
                    className={`cal-dot ${i === idx ? "active" : ""}`}
                    onClick={() => setIdx(i)}
                  />
                ))}
              </div>
              <button
                className="cal-slider-arrow"
                onClick={() => setIdx((i) => (i + 1) % outfits.length)}
              >›</button>
            </div>
          )}
        </div>
      ) : (
        <div className="cal-empty-day">
          <span>No outfit planned</span>
        </div>
      )}
    </div>
  );
}

function CalItem({ item }) {
  const [imgErr, setImgErr] = useState(false);
  return (
    <div className="cal-item-large" title={item.name}>
      {item.image_url && !imgErr ? (
        <img
          src={item.image_url}
          alt={item.name}
          onError={() => setImgErr(true)}
        />
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
