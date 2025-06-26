const { Telegraf } = require('telegraf');
const knex = require('knex')({
  client: 'sqlite3',
  connection: { filename: './queue.db' },
  useNullAsDefault: true
});

const bot = new Telegraf('7794224797:AAFhNDfHkPEoOLxCzRzMsO_JQK72Wc2BOWU'); // Замени на токен из @BotFather

// Создаем таблицы в базе данных
async function initDB() {
  await knex.schema.createTableIfNotExists('queues', table => {
    table.increments('id').primary();
    table.string('title');
    table.integer('admin_id');
    table.string('meet_link');
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });
  
  await knex.schema.createTableIfNotExists('participants', table => {
    table.increments('id').primary();
    table.integer('queue_id');
    table.integer('user_id');
    table.string('username');
    table.integer('position');
    table.string('status').defaultTo('waiting');
  });
}

// Команда /start
bot.start(ctx => ctx.reply('Привет! Я бот для управления очередью на созвоны. Используй /help для списка команд.'));

// Команда /help
bot.command('help', ctx => {
  ctx.reply(`
📌 **Команды для админа**:
/createqueue Название - Создать очередь
/adduser @username - Добавить участника
/next - Вызвать следующего
/viewqueue - Показать очередь

📌 **Команды для участников**:
/mystatus - Моя позиция
/leave - Выйти из очереди
  `);
});

// Создание очереди
bot.command('createqueue', async ctx => {
  const [_, title] = ctx.message.text.split(' ');
  const meetLink = `https://meet.google.com/${Math.random().toString(36).substr(2, 9)}`;
  
  await knex('queues').insert({
    title,
    admin_id: ctx.from.id,
    meet_link: meetLink
  });
  
  ctx.reply(`✅ Очередь "${title}" создана!`);
});

// Добавление участника
bot.command('adduser', async ctx => {
  const [_, username] = ctx.message.text.split(' ');
  const queue = await knex('queues').where({ admin_id: ctx.from.id }).first();
  
  if (!queue) return ctx.reply('❌ У вас нет очереди! Сначала создайте её через /createqueue');
  
  const position = await knex('participants')
    .where({ queue_id: queue.id })
    .count('* as count')
    .first()
    .then(res => res.count + 1);
  
  await knex('participants').insert({
    queue_id: queue.id,
    username,
    position,
    user_id: username.replace('@', '')
  });
  
  ctx.reply(`✅ @${username} добавлен в очередь "${queue.title}" (позиция: ${position})`);
});

// Вызов следующего
bot.command('next', async ctx => {
  const queue = await knex('queues').where({ admin_id: ctx.from.id }).first();
  if (!queue) return ctx.reply('❌ У вас нет очереди!');
  
  const nextUser = await knex('participants')
    .where({ queue_id: queue.id, status: 'waiting' })
    .orderBy('position', 'asc')
    .first();
  
  if (!nextUser) return ctx.reply('❌ Очередь пуста!');
  
  await knex('participants')
    .where({ id: nextUser.id })
    .update({ status: 'active' });
  
  ctx.telegram.sendMessage(
    nextUser.user_id,
    `🎉 Ваша очередь! Подключитесь: ${queue.meet_link}`
  );
  
  ctx.reply(`👉 Вызван @${nextUser.username}`);
});

// Просмотр очереди
bot.command('viewqueue', async ctx => {
  const queue = await knex('queues').where({ admin_id: ctx.from.id }).first();
  if (!queue) return ctx.reply('❌ У вас нет очереди!');
  
  const participants = await knex('participants')
    .where({ queue_id: queue.id })
    .orderBy('position', 'asc');
  
  let message = `📋 Очередь: ${queue.title}\n\n`;
  participants.forEach(p => {
    message += `${p.position}. @${p.username} (${p.status === 'waiting' ? '⏳' : '✅'})\n`;
  });
  
  ctx.reply(message);
});

// Проверка позиции
bot.command('mystatus', async ctx => {
  const queues = await knex('participants')
    .where({ user_id: ctx.from.id })
    .join('queues', 'participants.queue_id', 'queues.id')
    .select('queues.title', 'participants.position', 'participants.status');
  
  if (!queues.length) return ctx.reply('ℹ️ Вы не в очереди');
  
  let message = '📊 Ваши очереди:\n\n';
  queues.forEach(q => {
    message += `🔹 ${q.title}: ${q.status === 'waiting' ? `Позиция ${q.position}` : 'Сейчас ваша очередь!'}\n`;
  });
  
  ctx.reply(message);
});

// Запуск бота
initDB().then(() => {
  bot.launch();
  console.log('Бот запущен!');
});