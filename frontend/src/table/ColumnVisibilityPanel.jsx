import React, { useState, useRef, useEffect } from 'react';
import { Columns3 } from 'lucide-react';
import { TABLE_COLUMNS } from './tableColumnsConfig';

export default function ColumnVisibilityPanel({ visibleColumnIds, onVisibilityChange }) {
  const [open, setOpen] = useState(false);
  const [localVisible, setLocalVisible] = useState(new Set(visibleColumnIds || []));
  const ref = useRef(null);

  useEffect(() => {
    setLocalVisible(new Set(visibleColumnIds || []));
  }, [visibleColumnIds]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const toggle = (colId) => {
    const col = TABLE_COLUMNS.find((c) => c.id === colId);
    if (col?.isRequired) return;
    setLocalVisible((prev) => {
      const next = new Set(prev);
      if (next.has(colId)) next.delete(colId);
      else next.add(colId);
      const ordered = TABLE_COLUMNS.filter((c) => next.has(c.id)).map((c) => c.id);
      onVisibilityChange(ordered);
      return next;
    });
  };

  return (
    <span className="column-visibility" ref={ref}>
      <button
        type="button"
        className="columns-toggle-btn"
        onClick={() => setOpen(!open)}
        title="Настроить колонки"
        aria-label="Колонки"
      >
        <Columns3 size={18} />
        Колонки
      </button>
      {open && (
        <div className="column-visibility-popup">
          <div className="column-visibility-title">Отображаемые поля</div>
          <div className="column-visibility-list">
            {TABLE_COLUMNS.map((col) => (
              <label
                key={col.id}
                className={`column-visibility-item ${col.isRequired ? 'required' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={localVisible.has(col.id)}
                  disabled={col.isRequired}
                  onChange={() => toggle(col.id)}
                  title={col.isRequired ? 'Обязательное поле' : undefined}
                />
                <span className="column-visibility-label">
                  {col.label}
                  {col.isRequired && <span className="required-badge">обязательное</span>}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}
