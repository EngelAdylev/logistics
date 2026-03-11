import React from 'react';

export default function WagonRow({ wagon, onSelect }) {
  return (
    <tr
      className="h-wagon-clickrow"
      onClick={() => onSelect(wagon)}
      title="Нажмите для просмотра рейсов"
    >
      <td className="h-wagon-number">
        <strong>{wagon.railway_carriage_number}</strong>
      </td>

      <td className="h-wagon-status">
        <span className={`h-status-badge ${wagon.is_active ? 'h-status-active' : 'h-status-archived'}`}>
          {wagon.is_active ? 'Активен' : 'Архив'}
        </span>
      </td>

      <td className="h-wagon-trips">
        <span title="Всего рейсов">{wagon.trip_count ?? 0}</span>
        {wagon.active_trip_count > 0 && (
          <span className="h-wagon-active-trips" title="Активных рейсов">
            {' '}({wagon.active_trip_count} акт.)
          </span>
        )}
      </td>
    </tr>
  );
}
