import React, { useState, useRef, useEffect } from 'react';
import { Columns3 } from 'lucide-react';
import { TABLE_COLUMNS } from './tableColumnsConfig';

export default function ColumnVisibilityPanel({ visibleColumnIds, onVisibilityChange, columns: columnsProp }) {
  const columns = columnsProp || TABLE_COLUMNS;
  const [open, setOpen] = useState(false);
  const [popupStyle, setPopupStyle] = useState({});
  const [localVisible, setLocalVisible] = useState(new Set(visibleColumnIds || []));
  const [search, setSearch] = useState('');
  const btnRef = useRef(null);
  const popupRef = useRef(null);

  useEffect(() => {
    setLocalVisible(new Set(visibleColumnIds || []));
  }, [visibleColumnIds]);

  // Позиционируем попап через fixed — избегаем перекрытия таблицами
  const openPopup = () => {
    if (open) { setOpen(false); return; }
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPopupStyle({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    }
    setOpen(true);
    setSearch('');
  };

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (
        popupRef.current && !popupRef.current.contains(e.target) &&
        btnRef.current && !btnRef.current.contains(e.target)
      ) setOpen(false);
    }
    function handleScroll(e) {
      // Не закрывать если скроллят внутри самого попапа
      if (popupRef.current && popupRef.current.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [open]);

  const toggle = (colId) => {
    const col = columns.find((c) => c.id === colId);
    if (col?.isRequired) return;
    setLocalVisible((prev) => {
      const next = new Set(prev);
      if (next.has(colId)) next.delete(colId);
      else next.add(colId);
      const ordered = columns.filter((c) => next.has(c.id)).map((c) => c.id);
      onVisibilityChange(ordered);
      return next;
    });
  };

  const filteredColumns = search.trim()
    ? columns.filter((c) => c.label.toLowerCase().includes(search.toLowerCase()))
    : columns;

  return (
    <span className="column-visibility">
      <button
        ref={btnRef}
        type="button"
        className="compact-icon-btn"
        onClick={openPopup}
        title="Настроить колонки"
        aria-label="Колонки"
      >
        <Columns3 size={15} />
      </button>
      {open && (
        <div
          ref={popupRef}
          className="column-visibility-popup"
          style={popupStyle}
        >
          <div className="filter-search-wrap">
            <input
              type="text"
              className="filter-search-input"
              placeholder="Поиск колонки…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          <div className="column-visibility-list">
            {filteredColumns.map((col) => (
              <label
                key={col.id}
                className={`column-visibility-item ${col.isRequired ? 'required' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={localVisible.has(col.id)}
                  disabled={col.isRequired}
                  onChange={() => toggle(col.id)}
                />
                <span className="column-visibility-label">
                  {col.label}
                  {col.isRequired && <span className="required-badge">*</span>}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}
