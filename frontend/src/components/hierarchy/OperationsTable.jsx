import React from 'react';

function formatDate(val) {
  if (!val) return '—';
  return new Date(val).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function OperationsTable({ operations, loading }) {
  if (loading) return <div className="h-ops-loading">Загрузка операций…</div>;
  if (!operations || operations.length === 0) {
    return <div className="h-ops-empty">Операции не найдены</div>;
  }

  return (
    <div className="h-ops-wrapper">
      <table className="h-ops-table">
        <thead>
          <tr>
            <th>Дата и время</th>
            <th>Операция</th>
            <th>Станция</th>
            <th>Ост. расст.</th>
            <th>Поезд</th>
            <th>№ ваг. на поезде</th>
          </tr>
        </thead>
        <tbody>
          {operations.map((op) => (
            <tr key={op.id}>
              <td className="h-ops-date">{formatDate(op.operation_datetime)}</td>
              <td>
                {op.operation_name || op.operation_code || '—'}
                {op.operation_code && op.operation_name && (
                  <span className="h-ops-code"> ({op.operation_code})</span>
                )}
              </td>
              <td>{op.station_name || op.station_code || '—'}</td>
              <td>{op.remaining_distance || '—'}</td>
              <td>{op.number_train || '—'}</td>
              <td>{op.number_railway_carriage_on_train || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
