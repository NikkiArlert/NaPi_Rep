// Мини-приложение для Telegram WebApp — панель управления очередью
// Использует Telegram WebApp API (window.Telegram.WebApp) и REST API backend (нужно создать отдельно)

import { useEffect, useState } from 'react';

export default function QueueWebApp() {
  const [queue, setQueue] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [loading, setLoading] = useState(true);

  const tg = window.Telegram?.WebApp;

  useEffect(() => {
    tg?.expand();
    fetchQueue();
  }, []);

  async function fetchQueue() {
    try {
      const res = await fetch('/api/queue');
      const data = await res.json();
      setQueue(data.queue);
      setParticipants(data.participants);
    } catch (e) {
      console.error('Ошибка загрузки очереди:', e);
    } finally {
      setLoading(false);
    }
  }

  async function callNext() {
    await fetch('/api/next', { method: 'POST' });
    fetchQueue();
  }

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-2">Очередь</h1>
      {loading ? (
        <p>Загрузка...</p>
      ) : (
        <>
          <div className="mb-4">
            <p className="font-semibold">{queue?.title}</p>
            <p className="text-sm text-gray-500">Ссылка: {queue?.meet_link || 'не указана'}</p>
          </div>

          <div className="space-y-2">
            {participants.map(p => (
              <div
                key={p.id}
                className={`rounded p-2 ${p.status === 'active' ? 'bg-green-100' : 'bg-gray-100'}`}
              >
                {p.position}. @{p.username} {p.group_name && `[${p.group_name}]`} — {p.status}
              </div>
            ))}
          </div>

          <button
            onClick={callNext}
            className="mt-4 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            ⏭️ Вызвать следующего
          </button>
        </>
      )}
    </div>
  );
}
