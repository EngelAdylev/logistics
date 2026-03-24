import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Filter } from 'lucide-react';
import { getUniqueValues } from './tableUtils';

export default function ColumnFilter({ columnId, label, rows, activeValues, onApply, onClear }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(new Set(activeValues || []));
  const [search, setSearch] = useState('');
  const [popupStyle, setPopupStyle] = useState({});
  const ref = useRef(null);
  const searchRef = useRef(null);

  const options = getUniqueValues(rows, columnId);
  const hasActive = activeValues?.length > 0;

  const filteredOptions = search.trim()
    ? options.filter((opt) => (opt || '').toLowerCase().includes(search.toLowerCase()))
    : options;

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
      setSearch('');
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open]);                    // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
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
  const selectAll = () => setSelected(new Set(filteredOptions));

  if (options.length === 0) return null;

  return (
    <span className="column-filter" ref={ref}>
      <button
        type="button"
        className={`filter-trigger ${hasActive ? 'active' : ''}`}
        onClick={() => { if (!open) positionPopup(); setOpen((v) => !v); }}
        title={`Фильтр: ${label}`}
        aria-label={`Фильтр по ${label}`}
      >
        <Filter size={13} />
        {hasActive && <span className="filter-badge">{activeValues.length}</span>}
      </button>
      {open && (
        <div className="filter-popup" style={popupStyle}>
          <div className="filter-search-wrap">
            <input
              ref={searchRef}
              type="text"
              className="filter-search-input"
              placeholder="Поиск…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="filter-options">
            {filteredOptions.length === 0 ? (
              <div className="filter-no-results">Ничего не найдено</div>
            ) : (
              filteredOptions.map((opt) => (
                <label key={opt} className="filter-option">
                  <input
                    type="checkbox"
                    checked={selected.has(opt)}
                    onChange={() => toggle(opt)}
                  />
                  <span className="filter-option-label">{opt}</span>
                </label>
              ))
            )}
          </div>
          <div className="filter-actions">
            <button type="button" className="filter-clear-btn" onClick={handleClear}>Сбросить</button>
            <button type="button" className="filter-selectall-btn" onClick={selectAll}>Все</button>
            <button type="button" className="filter-apply-btn" onClick={handleApply}>OK</button>
          </div>
        </div>
      )}
    </span>
  );
}
