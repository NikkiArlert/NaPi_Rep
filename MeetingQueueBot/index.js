const { Telegraf, Markup } = require('telegraf');
const knex = require('knex')({
  client: 'sqlite3',
  connection: { filename: './queue.db' },
  useNullAsDefault: true
});

const bot = new Telegraf('7794224797:AAFhNDfHkPEoOLxCzRzMsO_JQK72Wc2BOWU'); // <-- токен

const awaitingLinkAdmins = new Map(); // будет содержать строки типа 'userId-queueId'

// Инициализация базы данных
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

// /start
bot.start(async ctx => {
  ctx.reply(`👋 Добро пожаловать в бот управления очередями!

Вы можете:
• Вступить в очередь — /join
• Проверить позицию — /mystatus
• Открыть WebApp — /webapp
• Создать очередь — /createqueue Название

Полный список — /help`);
});

// /help
bot.command('help', ctx => {
  ctx.reply(`
📌 Команды:
/start - Панель управления
/createqueue "название очререди" - создать очередь
/queueinfo - информация об очереди (Должно появляться сообщение с описанием очереди)
/next - вызвать следубщего
/viewqueue - смотреть очередь (Должно появляться сообщение с визуализацией очереди)
/join - присоедениться к очереди (доработать чтобы можно было присоеденится к конкретной очереди)
/mystatus - проверить статус
/admin - открыть админ-панель
/webapp - открыть Web-приложение
  `);
});

// /createqueue Название
bot.command('createqueue', async ctx => {
  const [_, ...rest] = ctx.message.text.split(' ');
  const title = rest.join(' ').trim();
  if (!title) return ctx.reply('❗ Укажите название очереди: /createqueue Название');

  await knex('queues').insert({
    title,
    admin_id: ctx.from.id,
    meet_link: ''
  });

  ctx.reply(`✅ Очередь "${title}" создана!\nНе забудьте указать ссылку через /admin → "Указать ссылку встречи"`);
});

// /queueinfo — показать ссылку
bot.command('queueinfo', async ctx => {
  const queue = await knex('queues').where({ admin_id: ctx.from.id }).first();
  if (!queue) return ctx.reply('❌ У вас нет очереди.');
  const link = queue.meet_link || 'ссылка не указана';
  ctx.reply(`ℹ️ Очередь "${queue.title}"\n🔗 ${link}`);
});

// /join — участник вступает
bot.command('join', async ctx => {
  const queue = await knex('queues').orderBy('created_at', 'desc').first();
  if (!queue) return ctx.reply('Очередь пока не создана.');

  const exists = await knex('participants')
    .where({ queue_id: queue.id, user_id: ctx.from.id })
    .first();

  if (exists) return ctx.reply('Вы уже в очереди.');

  const count = await knex('participants')
    .where({ queue_id: queue.id })
    .count('* as count')
    .first();

  const position = Number(count.count) + 1;

  await knex('participants').insert({
    queue_id: queue.id,
    user_id: ctx.from.id,
    username: ctx.from.username || '',
    position,
    status: 'waiting'
  });

  ctx.reply(`✅ Вы добавлены в очередь "${queue.title}". Позиция: ${position}`);
});

// /next — вызвать следующего
bot.command('next', async ctx => {
  const queue = await knex('queues').where({ admin_id: ctx.from.id }).first();
  if (!queue) return ctx.reply('❌ У вас нет очереди!');

  const nextUser = await knex('participants')
    .where({ queue_id: queue.id, status: 'waiting' })
    .orderBy('position', 'asc')
    .first();

  if (!nextUser) return ctx.reply('Очередь пуста.');

  await knex('participants')
    .where({ id: nextUser.id })
    .update({ status: 'active' });

  try {
    await ctx.telegram.sendMessage(
      nextUser.user_id,
      `🎉 Ваша очередь! Подключитесь: ${queue.meet_link || '[ссылка не указана]'}` 
    );
    ctx.reply(`👉 Вызван @${nextUser.username || 'пользователь без username'}`);
  } catch (e) {
    ctx.reply(`⚠️ Не удалось отправить сообщение участнику. Возможно, он не писал первым боту.`);
  }
});

// /viewqueue
bot.command('viewqueue', async ctx => {
  const queue = await knex('queues').where({ admin_id: ctx.from.id }).first();
  if (!queue) return ctx.reply('❌ У вас нет очереди.');

  const participants = await knex('participants')
    .where({ queue_id: queue.id })
    .orderBy('position', 'asc');

  if (!participants.length) return ctx.reply('Очередь пуста.');

  let message = `📋 Очередь: ${queue.title}\n\n`;
  participants.forEach(p => {
    message += `${p.position}. @${p.username || 'без имени'} (${p.status === 'waiting' ? '⏳' : '✅'})\n`;
  });

  ctx.reply(message);
});

// /mystatus
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

// /admin — панель с кнопками
bot.command('admin', async ctx => {
  const queue = await knex('queues').where({ admin_id: ctx.from.id }).first();

  if (!queue) {
    return ctx.reply('❌ У вас пока нет очереди. Создайте её через /createqueue');
  }

  return ctx.reply(
    `🔧 Панель управления очередью "${queue.title}"`,
    Markup.inlineKeyboard([
      [Markup.button.callback('👥 Посмотреть очередь', 'VIEW_QUEUE')],
      [Markup.button.callback('⏭️ Вызвать следующего', 'NEXT_USER')],
      [Markup.button.callback('🔗 Указать ссылку встречи', 'SET_MEET_LINK')],
      [Markup.button.callback('ℹ️ Информация об очереди', 'QUEUE_INFO')]
    ])
  );
});

bot.command('webapp', (ctx) => {
  ctx.reply('Открыть панель управления', {
    reply_markup: {
      inline_keyboard: [[
        {
          text: 'Открыть мини-приложение',
          web_app: { url: 'http://localhost:5173' }
        }
      ]]
    }
  });
});

bot.command('adminpanel', async ctx => {
  const queues = await knex('queues').where({ admin_id: ctx.from.id }).orderBy('created_at', 'desc');

  if (!queues.length) {
    return ctx.reply('❌ У вас нет созданных очередей. Используйте /createqueue');
  }

  for (const queue of queues) {
    await ctx.reply(
      `📋 Панель для очереди: "${queue.title}"`,
      Markup.inlineKeyboard([
        [Markup.button.callback(`👥 Очередь (${queue.title})`, `VIEW_QUEUE_${queue.id}`)],
        [Markup.button.callback('⏭️ Вызвать следующего', `NEXT_USER_${queue.id}`)],
        [Markup.button.callback('🔗 Указать ссылку', `SET_MEET_LINK_${queue.id}`)],
        [Markup.button.callback('ℹ️ Инфо', `QUEUE_INFO_${queue.id}`)],
        [Markup.button.callback('🗑️ Удалить', `DELETE_QUEUE_${queue.id}`)],
      ])
    );
  }
});



// Обработка кнопок
bot.on('callback_query', async ctx => {
  const data = ctx.callbackQuery.data;
  const userId = ctx.from.id;

  const match = data.match(/(VIEW_QUEUE|NEXT_USER|SET_MEET_LINK|QUEUE_INFO|DELETE_QUEUE)_(\\d+)/);
  if (!match) return;

  const action = match[1];
  const queueId = parseInt(match[2]);

  const queue = await knex('queues').where({ id: queueId, admin_id: userId }).first();
  if (!queue) return ctx.reply('❌ Очередь не найдена или вы не являетесь её админом.');

  ctx.deleteMessage();

  switch (action) {
    case 'VIEW_QUEUE': {
      const participants = await knex('participants').where({ queue_id: queue.id }).orderBy('position');
      if (!participants.length) return ctx.reply('Очередь пуста.');
      let text = `📋 Очередь: ${queue.title}\n\n`;
      for (const p of participants) {
        text += `${p.position}. @${p.username || 'без имени'} (${p.status})\n`;
      }
      ctx.reply(text);
      break;
    }

    case 'NEXT_USER': {
      const next = await knex('participants')
        .where({ queue_id: queue.id, status: 'waiting' })
        .orderBy('position')
        .first();
      if (!next) return ctx.reply('Очередь пуста.');

      await knex('participants').where({ id: next.id }).update({ status: 'active' });

      try {
        await ctx.telegram.sendMessage(
          next.user_id,
          `🎉 Ваша очередь в "${queue.title}"!\nПодключитесь: ${queue.meet_link || '[ссылка не указана]'}`
        );
        ctx.reply(`✅ Вызван @${next.username}`);
      } catch {
        ctx.reply(`⚠️ Не удалось отправить сообщение. Возможно, пользователь не писал боту первым.`);
      }
      break;
    }

    case 'SET_MEET_LINK': {
      awaitingLinkAdmins.add(userId + '-' + queueId);
      ctx.reply('📨 Введите новую ссылку:');
      break;
    }

    case 'QUEUE_INFO': {
      ctx.reply(`ℹ️ Очередь "${queue.title}"\n🔗 ${queue.meet_link || 'ссылка не указана'}`);
      break;
    }

    case 'DELETE_QUEUE': {
      await knex('participants').where({ queue_id: queue.id }).del();
      await knex('queues').where({ id: queue.id }).del();
      ctx.reply(`🗑️ Очередь "${queue.title}" удалена.`);
      break;
    }
  }
});

bot.on('text', async ctx => {
  const matches = [...awaitingLinkAdmins].find(key => key.startsWith(ctx.from.id + '-'));
  if (matches) {
    const queueId = parseInt(matches.split('-')[1]);
    const link = ctx.message.text.trim();
    await knex('queues').where({ id: queueId }).update({ meet_link: link });
    awaitingLinkAdmins.delete(matches);
    return ctx.reply(`✅ Ссылка для очереди обновлена: ${link}`);
  }
});




// Запуск
initDB().then(() => {
  bot.launch();
  console.log('Бот запущен!');
});
