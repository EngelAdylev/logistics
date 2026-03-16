import React, { useState, useRef, useEffect } from 'react';
import { Filter } from 'lucide-react';
import { getUniqueValues } from './tableUtils';

export default function ColumnFilter({ columnId, label, rows, activeValues, onApply, onClear }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(new Set(activeValues || []));
  const [openUpward, setOpenUpward] = useState(false);
  const ref = useRef(null);
  const popupRef = useRef(null);

  const options = getUniqueValues(rows, columnId);
  const hasActive = activeValues?.length > 0;

  useEffect(() => {
    if (open) setSelected(new Set(activeValues || []));
  }, [open, activeValues]);

  // Флип вверх, если попап вылезает за нижний край viewport
  useEffect(() => {
    if (open && popupRef.current) {
      const rect = popupRef.current.getBoundingClientRect();
      setOpenUpward(rect.bottom > window.innerHeight - 8);
    }
    if (!open) setOpenUpward(false);
  }, [open]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const toggle = (val) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(val)) next.delete(val);
      else next.add(val);
      return next;
    });
  };

  const handleApply = () => {
    onApply(Array.from(selected));
    setOpen(false);
  };

  const handleClear = () => {
    setSelected(new Set());
    onClear();
    setOpen(false);
  };

  if (options.length === 0) return null;

  return (
    <span className="column-filter" ref={ref}>
      <button
        type="button"
        className={`filter-trigger ${hasActive ? 'active' : ''}`}
        onClick={() => setOpen(!open)}
        title="Фильтр"
        aria-label={`Фильтр по ${label}`}
      >
        <Filter size={14} />
        {hasActive && <span className="filter-badge">{activeValues.length}</span>}
      </button>
      {open && (
        <div
          className={`filter-popup${openUpward ? ' filter-popup--up' : ''}`}
          ref={popupRef}
        >
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
            <button type="button" className="filter-clear-btn" onClick={handleClear}>
              Сбросить
            </button>
            <button type="button" className="filter-apply-btn" onClick={handleApply}>
              Применить
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
