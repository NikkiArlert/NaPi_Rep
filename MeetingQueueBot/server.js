// server.js — простой backend для WebApp очереди (Express + SQLite через Knex)

const express = require('express');
const cors = require('cors');
const knex = require('knex')({
  client: 'sqlite3',
  connection: { filename: './queue.db' },
  useNullAsDefault: true
});

const app = express();
app.use(cors());
app.use(express.json());

// [GET] Получить текущую очередь и участников
app.get('/api/queue', async (req, res) => {
  const queue = await knex('queues').orderBy('created_at', 'desc').first();
  if (!queue) return res.status(404).json({ error: 'Queue not found' });

  const participants = await knex('participants')
    .where({ queue_id: queue.id })
    .orderBy('position', 'asc');

  res.json({ queue, participants });
});

// [POST] Вызвать следующего участника
app.post('/api/next', async (req, res) => {
  const queue = await knex('queues').orderBy('created_at', 'desc').first();
  if (!queue) return res.status(404).json({ error: 'Queue not found' });

  const next = await knex('participants')
    .where({ queue_id: queue.id, status: 'waiting' })
    .orderBy('position')
    .first();

  if (!next) return res.status(200).json({ message: 'Queue is empty' });

  await knex('participants').where({ id: next.id }).update({ status: 'active' });

  res.json({ message: `Participant ${next.username} activated` });
});

// Запуск сервера
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Backend запущен на http://localhost:${PORT}`);
});
