import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Filter } from 'lucide-react';
import { getUniqueValues } from './tableUtils';

export default function ColumnFilter({ columnId, label, rows, activeValues, onApply, onClear }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(new Set(activeValues || []));
  const [popupStyle, setPopupStyle] = useState({});
  const ref = useRef(null);

  const options = getUniqueValues(rows, columnId);
  const hasActive = activeValues?.length > 0;

  // Рассчитываем позицию попапа через fixed — выходит из любого overflow-контейнера
  const positionPopup = useCallback(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom - 8;
    const spaceAbove = r.top - 8;

    const style = {
      position: 'fixed',
      left: Math.max(4, Math.min(r.left, window.innerWidth - 188)),
      zIndex: 9999,
    };

    if (spaceBelow >= 200 || spaceBelow >= spaceAbove) {
      style.top = r.bottom + 4;
      style.maxHeight = Math.min(280, Math.max(spaceBelow, 120));
    } else {
      style.bottom = window.innerHeight - r.top + 4;
      style.maxHeight = Math.min(280, Math.max(spaceAbove, 120));
    }

    setPopupStyle(style);
  }, []);

  useEffect(() => {
    if (open) {
      setSelected(new Set(activeValues || []));
    }
  }, [open]);                    // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    // Перепозиционировать при скролле (таблица внутри scroll-контейнера)
    function handleScroll() { positionPopup(); }
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open, positionPopup]);

  const toggle = (val) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(val)) next.delete(val);
      else next.add(val);
      return next;
    });
  };

  const handleApply = () => { onApply(Array.from(selected)); setOpen(false); };
  const handleClear = () => { setSelected(new Set()); onClear(); setOpen(false); };

  if (options.length === 0) return null;

  return (
    <span className="column-filter" ref={ref}>
      <button
        type="button"
        className={`filter-trigger ${hasActive ? 'active' : ''}`}
        onClick={() => { if (!open) positionPopup(); setOpen((v) => !v); }}
        title="Фильтр"
        aria-label={`Фильтр по ${label}`}
      >
        <Filter size={14} />
        {hasActive && <span className="filter-badge">{activeValues.length}</span>}
      </button>
      {open && (
        <div className="filter-popup" style={popupStyle}>
          <div className="filter-title">{label}</div>
          <div className="filter-options">
            {options.map((opt) => (
              <label key={opt} className="filter-option">
                <input
                  type="checkbox"
                  checked={selected.has(opt)}
                  onChange={() => toggle(opt)}
                />
                <span className="filter-option-label">{opt}</span>
              </label>
            ))}
          </div>
          <div className="filter-actions">
            <button type="button" className="filter-clear-btn" onClick={handleClear}>Сбросить</button>
            <button type="button" className="filter-apply-btn" onClick={handleApply}>Применить</button>
          </div>
        </div>
      )}
    </span>
  );
}
