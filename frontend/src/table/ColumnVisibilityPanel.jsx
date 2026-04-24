import React, { useState, useRef, useEffect } from 'react';
import { Columns3, GripVertical } from 'lucide-react';
import { TABLE_COLUMNS } from './tableColumnsConfig';

export default function ColumnVisibilityPanel({ visibleColumnIds, onVisibilityChange, columns: columnsProp }) {
  const columns = columnsProp || TABLE_COLUMNS;
  const [open, setOpen] = useState(false);
  const [popupStyle, setPopupStyle] = useState({});
  const [localOrder, setLocalOrder] = useState(visibleColumnIds || []);
  const [search, setSearch] = useState('');
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const btnRef = useRef(null);
  const popupRef = useRef(null);

  useEffect(() => {
    setLocalOrder(visibleColumnIds || []);
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

    let newOrder;
    if (localOrder.includes(colId)) {
      // Удаляем из видимых
      newOrder = localOrder.filter((id) => id !== colId);
    } else {
      // Добавляем: сохраняем порядок из конфига
      const visibleSet = new Set([...localOrder, colId]);
      newOrder = columns.filter((c) => visibleSet.has(c.id)).map((c) => c.id);
    }
    setLocalOrder(newOrder);
    onVisibilityChange(newOrder);
  };

  // Drag-and-drop handlers
  const handleDragStart = (colId, e) => {
    setDraggedId(colId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', colId);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragEnter = (colId) => {
    setDragOverId(colId);
  };

  const handleDragLeave = () => {
    setDragOverId(null);
  };

  const handleDrop = (targetId, e) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }

    // Находим индексы
    const draggedIdx = localOrder.indexOf(draggedId);
    const targetIdx = localOrder.indexOf(targetId);

    if (draggedIdx === -1 || targetIdx === -1) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }

    // Создаём новый порядок
    const newOrder = [...localOrder];
    newOrder.splice(draggedIdx, 1);
    newOrder.splice(targetIdx, 0, draggedId);

    setLocalOrder(newOrder);
    onVisibilityChange(newOrder);
    setDraggedId(null);
    setDragOverId(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
  };

  const visibleSet = new Set(localOrder);
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
        title="Настроить колонки (перетаскивайте для переупорядочения)"
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
            {/* Видимые колонки (можно переупорядочивать) */}
            {localOrder.length > 0 && (
              <>
                <div className="column-visibility-section-label">Видимые колонки</div>
                {localOrder
                  .filter((colId) => filteredColumns.some((c) => c.id === colId))
                  .map((colId) => {
                    const col = columns.find((c) => c.id === colId);
                    if (!col) return null;
                    return (
                      <div
                        key={col.id}
                        draggable
                        onDragStart={(e) => handleDragStart(col.id, e)}
                        onDragOver={handleDragOver}
                        onDragEnter={() => handleDragEnter(col.id)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(col.id, e)}
                        onDragEnd={handleDragEnd}
                        className={`column-visibility-item draggable ${
                          draggedId === col.id ? 'dragging' : ''
                        } ${dragOverId === col.id ? 'drag-over' : ''}`}
                        style={{
                          opacity: draggedId === col.id ? 0.5 : 1,
                          cursor: 'move',
                        }}
                      >
                        <GripVertical size={13} className="drag-handle" />
                        <input
                          type="checkbox"
                          checked={true}
                          onChange={() => toggle(col.id)}
                        />
                        <span className="column-visibility-label">{col.label}</span>
                      </div>
                    );
                  })}
              </>
            )}

            {/* Скрытые колонки */}
            {filteredColumns.some((c) => !localOrder.includes(c.id)) && (
              <>
                <div className="column-visibility-section-label">Скрытые колонки</div>
                {filteredColumns
                  .filter((c) => !localOrder.includes(c.id))
                  .map((col) => (
                    <label
                      key={col.id}
                      className={`column-visibility-item ${col.isRequired ? 'required' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={false}
                        disabled={col.isRequired}
                        onChange={() => toggle(col.id)}
                      />
                      <span className="column-visibility-label">
                        {col.label}
                        {col.isRequired && <span className="required-badge">*</span>}
                      </span>
                    </label>
                  ))}
              </>
            )}
          </div>
        </div>
      )}
    </span>
  );
}
