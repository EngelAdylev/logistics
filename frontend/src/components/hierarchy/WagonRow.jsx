import React, { useState } from 'react';
import { ChevronRight, MessageSquare } from 'lucide-react';
import WagonComments from './WagonComments';
import WagonTripsModal from './WagonTripsModal';

const MAX_COMMENT_LENGTH = 60;

function formatDate(v) {
  return v ? new Date(v).toLocaleString() : '—';
}

function renderCell(wagon, col, onShowComments) {
  if (col.id === 'last_operation_date') return formatDate(wagon[col.accessorKey]);
  if (col.id === 'last_comment_text') {
    const text = wagon[col.accessorKey]?.toString?.()?.trim?.() ?? '';
    if (!text) return '—';
    const truncated = text.length > MAX_COMMENT_LENGTH ? `${text.slice(0, MAX_COMMENT_LENGTH)}…` : text;
    return <span title={text.length > MAX_COMMENT_LENGTH ? text : undefined}>{truncated}</span>;
  }
  if (col.id === 'chat') {
    return (
      <button
        type="button"
        className="h-comment-icon-btn"
        onClick={(e) => { e.stopPropagation(); onShowComments(); }}
        title="Комментарии к вагону"
      >
        <MessageSquare size={15} />
      </button>
    );
  }
  const v = wagon[col.accessorKey];
  return v?.toString?.()?.trim?.() ?? '—';
}

export default function WagonRow({
  wagon,
  isSelected,
  onToggleSelect,
  visibleCols,
}) {
  const [tripsModalOpen, setTripsModalOpen] = useState(false);
  const [showComments, setShowComments] = useState(false);

  return (
    <>
      <tr
        className="h-wagon-row h-wagon-clickrow"
        onClick={() => setTripsModalOpen(true)}
        title="Нажмите для просмотра рейсов"
      >
        {onToggleSelect != null && (
          <td className="h-wagon-check" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={!!isSelected}
              onChange={() => onToggleSelect(wagon.id)}
              className="h-bulk-checkbox"
              title="Выбрать"
            />
          </td>
        )}
        <td className="h-wagon-expand">
          <ChevronRight size={16} className="h-wagon-chevron" />
        </td>
        {visibleCols.map((col) => (
          <td key={col.id} className={col.id === 'railway_carriage_number' ? 'h-wagon-number' : undefined}>
            {col.id === 'railway_carriage_number'
              ? <strong>{wagon.railway_carriage_number}</strong>
              : renderCell(wagon, col, () => setShowComments(true))}
          </td>
        ))}
      </tr>

      {tripsModalOpen && (
        <WagonTripsModal wagon={wagon} onClose={() => setTripsModalOpen(false)} />
      )}

      {showComments && (
        <WagonComments wagon={wagon} onClose={() => setShowComments(false)} />
      )}
    </>
  );
}
