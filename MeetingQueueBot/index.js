const { Telegraf, Markup } = require('telegraf');
const knex = require('knex')({
  client: 'sqlite3',
  connection: { filename: './queue.db' },
  useNullAsDefault: true,
});
const bot = new Telegraf('7794224797:AAFhNDfHkPEoOLxCzRzMsO_JQK72Wc2BOWU'); // Твой токен

// --- Логирование ---
function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

// --- Состояния админов для ожидания ввода ---
const adminStates = new Map();

// --- Инициализация базы данных ---
async function initDB() {
  if (!(await knex.schema.hasTable('queues'))) {
    await knex.schema.createTable('queues', (table) => {
      table.increments('id').primary();
      table.string('title').notNullable();
      table.integer('admin_id').notNullable();
      table.string('admin_username').defaultTo('');
      table.string('meet_link').defaultTo('');
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
    log('Создана таблица queues');
  }

  if (!(await knex.schema.hasTable('participants'))) {
    await knex.schema.createTable('participants', (table) => {
      table.increments('id').primary();
      table.integer('queue_id').notNullable().references('queues.id').onDelete('CASCADE');
      table.integer('user_id').nullable();
      table.string('username').defaultTo('');
      table.integer('position').notNullable();
      table.string('status').defaultTo('waiting'); // waiting, active, done
    });
    log('Создана таблица participants');
  }

  if (!(await knex.schema.hasTable('users'))) {
    await knex.schema.createTable('users', (table) => {
      table.increments('id').primary();
      table.integer('user_id').unique().notNullable();
      table.string('username').unique().notNullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
    log('Создана таблица users');
  }
}

// --- Клавиатура админ-панели ---
function getAdminPanelKeyboard(queueId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('👥 Посмотреть участников', `VIEW_PARTICIPANTS_${queueId}`)],
    [Markup.button.callback('➕ Добавить пользователей', `ADD_USERS_${queueId}`)],
    [Markup.button.callback('🔗 Указать/изменить ссылку', `SET_LINK_${queueId}`)],
    [Markup.button.callback('⏭️ Вызвать следующего', `CALL_NEXT_${queueId}`)],
    [Markup.button.callback('🗑️ Удалить очередь', `DELETE_QUEUE_${queueId}`)],
    [Markup.button.callback('⬅️ Назад', 'ADMIN_BACK')],
  ]);
}

// --- Установка команд в меню Telegram ---
async function setCommands() {
  await bot.telegram.setMyCommands([
    { command: 'start', description: 'Приветствие и инструкции' },
    { command: 'help', description: 'Список команд' },
    { command: 'createqueue', description: 'Создать очередь' },
    { command: 'adminpanel', description: 'Управление очередями' },
    { command: 'listqueues', description: 'Список очередей админа' },
    { command: 'join', description: 'Присоединиться к очереди' },
    { command: 'mystatus', description: 'Проверить статус в очередях' },
  ]);
}

// --- /start ---
bot.start(async (ctx) => {
  await ctx.reply(
    `👋 Добро пожаловать в бот управления очередями!\n\n` +
      `Что вы можете делать:\n` +
      `• Админ:\n` +
      `  - Создавать очередь: /createqueue Название\n` +
      `  - Управлять очередями: /adminpanel\n` +
      `• Пользователь:\n` +
      `  - Посмотреть список очередей админа: /listqueues @username_админа\n` +
      `  - Присоединиться к очереди: /join @username_админа\n` +
      `  - Проверить статус: /mystatus\n\n` +
      `Для подробностей используйте /help`
  );
  log(`/start от пользователя ${ctx.from.id}`);
});

// --- /help ---
bot.help(async (ctx) => {
  await ctx.reply(
    `📌 Команды:\n` +
      `/start — приветствие и помощь\n` +
      `/createqueue Название — создать очередь (для админа)\n` +
      `/adminpanel — управление очередями (для админа)\n` +
      `/listqueues @username_админа — посмотреть очереди админа\n` +
      `/join @username_админа — присоединиться к очереди\n` +
      `/mystatus — проверить статус в очередях\n\n` +
      `Вызов следующего участника производится в панели управления конкретной очередью.`
  );
  log(`/help от пользователя ${ctx.from.id}`);
});

// --- /createqueue Название ---
bot.command('createqueue', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length === 0) {
    return ctx.reply('❗ Укажите название очереди. Пример: /createqueue Техподдержка');
  }
  const title = args.join(' ').trim();
  try {
    const [id] = await knex('queues').insert({
      title,
      admin_id: ctx.from.id,
      admin_username: ctx.from.username || '',
      meet_link: '',
    });
    await ctx.reply(`✅ Очередь "${title}" успешно создана! Используйте /adminpanel для управления.`);
    log(`Создана очередь "${title}" админом ${ctx.from.id} (id: ${id}, username: ${ctx.from.username})`);
  } catch (e) {
    log('Ошибка создания очереди:', e);
    await ctx.reply('❌ Ошибка при создании очереди.');
  }
});

// --- /listqueues @username_админа ---
bot.command('listqueues', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length === 0 || !args[0].startsWith('@')) {
    return ctx.reply('❗ Укажите username админа. Пример: /listqueues @adminuser');
  }
  const adminUsername = args[0].substring(1).toLowerCase();

  try {
    const queues = await knex('queues').whereRaw('lower(admin_username) = ?', [adminUsername]);
    if (queues.length === 0) {
      return ctx.reply(`У пользователя @${adminUsername} нет созданных очередей.`);
    }
    const list = queues.map(q => `ID: ${q.id} — "${q.title}"`).join('\n');
    await ctx.reply(`Очереди @${adminUsername}:\n${list}`);
  } catch (e) {
    log('Ошибка в /listqueues:', e);
    await ctx.reply('❌ Ошибка при получении списка очередей.');
  }
});

// --- Callback-запросы ---
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  const userId = ctx.from.id;

  if (data.startsWith('ADMIN_QUEUE_')) {
    const queueId = parseInt(data.split('_')[2]);
    try {
      const queue = await knex('queues').where({ id: queueId, admin_id: userId }).first();
      if (!queue) {
        await ctx.answerCbQuery('Очередь не найдена или вы не являетесь админом.');
        return;
      }
      await ctx.editMessageText(
        `🔧 Панель управления очередью "${queue.title}"\n\nВыберите действие:`,
        { reply_markup: getAdminPanelKeyboard(queueId).reply_markup }
      );
      await ctx.answerCbQuery();
    } catch (e) {
      console.error('Ошибка в ADMIN_QUEUE:', e);
      await ctx.answerCbQuery('Ошибка обработки запроса.');
    }
    return;
  }

  if (data === 'ADMIN_BACK') {
    try {
      const queues = await knex('queues').where({ admin_id: userId }).orderBy('created_at', 'desc');
      if (queues.length === 0) {
        await ctx.editMessageText('❌ У вас нет созданных очередей. Создайте через /createqueue');
        return;
      }
      const buttons = queues.map((q) => [Markup.button.callback(q.title, `ADMIN_QUEUE_${q.id}`)]);
      await ctx.editMessageText('Ваши очереди:', Markup.inlineKeyboard(buttons));
      await ctx.answerCbQuery();
    } catch (e) {
      console.error('Ошибка в ADMIN_BACK:', e);
      await ctx.answerCbQuery('Ошибка обработки запроса.');
    }
    return;
  }

  if (data.startsWith('VIEW_PARTICIPANTS_')) {
    const queueId = parseInt(data.split('_')[2]);
    try {
      const queue = await knex('queues').where({ id: queueId, admin_id: userId }).first();
      if (!queue) {
        await ctx.answerCbQuery('Очередь не найдена или вы не админ.');
        return;
      }
      const participants = await knex('participants').where({ queue_id: queueId }).orderBy('position', 'asc');
      if (participants.length === 0) {
        await ctx.answerCbQuery('Очередь пуста.');
        return;
      }
      let text = `👥 Участники очереди "${queue.title}":\n\n`;
      for (const p of participants) {
        text += `${p.position}. @${p.username || 'без имени'} — ${p.status}\n`;
      }
      await ctx.editMessageText(
        text,
        Markup.inlineKeyboard([[Markup.button.callback('⬅️ Назад', `ADMIN_QUEUE_${queueId}`)]])
      );
      await ctx.answerCbQuery();
    } catch (e) {
      console.error('Ошибка в VIEW_PARTICIPANTS:', e);
      await ctx.answerCbQuery('Ошибка обработки запроса.');
    }
    return;
  }

  if (data.startsWith('ADD_USERS_')) {
    const queueId = parseInt(data.split('_')[2]);
    adminStates.set(`${userId}-${queueId}`, { type: 'awaiting_usernames' });
    try {
      await ctx.editMessageText(
        'Введите username пользователей через запятую (например: @user1, @user2):\nПользователи будут добавлены в конец очереди.',
        Markup.inlineKeyboard([[Markup.button.callback('⬅️ Отмена', `ADMIN_QUEUE_${queueId}`)]])
      );
      await ctx.answerCbQuery();
    } catch (e) {
      console.error('Ошибка в ADD_USERS:', e);
      await ctx.answerCbQuery('Ошибка при запросе ввода.');
    }
    return;
  }

  if (data.startsWith('SET_LINK_')) {
    const queueId = parseInt(data.split('_')[2]);
    adminStates.set(`${userId}-${queueId}`, { type: 'awaiting_link' });
    try {
      await ctx.editMessageText(
        '🔗 Введите новую ссылку на видеоконференцию:',
        Markup.inlineKeyboard([[Markup.button.callback('⬅️ Отмена', `ADMIN_QUEUE_${queueId}`)]])
      );
      await ctx.answerCbQuery();
    } catch (e) {
      console.error('Ошибка в SET_LINK:', e);
      await ctx.answerCbQuery('Ошибка при запросе ссылки.');
    }
    return;
  }

  if (data.startsWith('CALL_NEXT_')) {
    const queueId = parseInt(data.split('_')[2]);
    try {
      const queue = await knex('queues').where({ id: queueId, admin_id: userId }).first();
      if (!queue) {
        return ctx.answerCbQuery('Очередь не найдена');
      }

      // Получаем следующего участника (любой: с user_id или без)
      const nextUser = await knex('participants')
        .where({ queue_id: queueId, status: 'waiting' })
        .orderBy('position')
        .first();

      if (!nextUser) {
        return ctx.answerCbQuery('Очередь пуста.');
      }

      await knex('participants').where({ id: nextUser.id }).update({ status: 'active' });

      if (nextUser.user_id) {
        try {
          await ctx.telegram.sendMessage(
            nextUser.user_id,
            `🎉 Ваша очередь в "${queue.title}"!\nПодключитесь: ${queue.meet_link || '[ссылка не указана]'}`
          );
        } catch (e) {
          log('Не удалось отправить участнику:', e);
        }
      }

      await knex('participants').where({ id: nextUser.id }).del();
      await ctx.answerCbQuery(`✅ Вызван @${nextUser.username || 'участник'}`);
    } catch (e) {
      log('Ошибка в CALL_NEXT:', e);
      await ctx.answerCbQuery('Ошибка вызова.');
    }
    return;
  }

  if (data.startsWith('DELETE_QUEUE_')) {
    const queueId = parseInt(data.split('_')[2]);
    try {
      const queue = await knex('queues').where({ id: queueId, admin_id: userId }).first();
      if (!queue) {
        await ctx.answerCbQuery('Очередь не найдена');
        return;
      }

      await knex('participants').where({ queue_id: queueId }).del();
      await knex('queues').where({ id: queueId }).del();

      await ctx.answerCbQuery(`✅ Очередь "${queue.title}" удалена.`);
      await ctx.editMessageText(`🗑️ Очередь "${queue.title}" была удалена.`);
    } catch (e) {
      console.error('Ошибка удаления очереди:', e);
      await ctx.answerCbQuery('Ошибка удаления.');
    }
    return;
  }

  // Неизвестный callback
  await ctx.answerCbQuery();
});

// --- Обработка сообщений для ожидания ввода админами ---
bot.on('message', async (ctx, next) => {
  const userId = ctx.from.id;
  const username = ctx.from.username ? ctx.from.username.toLowerCase() : null;

  if (username) {
    try {
      await knex('users')
        .insert({ user_id: userId, username })
        .onConflict('user_id') // если user_id уже есть — игнорируем
        .ignore();
    } catch (e) {
      console.error('Ошибка сохранения пользователя:', e);
    }
  }

  for (const [key, state] of adminStates.entries()) {
    if (!key.startsWith(`${userId}-`)) continue;

    const queueId = parseInt(key.split('-')[1]);
    const text = ctx.message.text || '';

    if (state.type === 'awaiting_usernames') {
      if (!text) {
        return ctx.reply('❗ Введите корректный список username через запятую.');
      }
      const usernames = text
        .split(',')
        .map((u) => u.trim().replace(/^@/, ''))
        .filter((u) => u.length > 0);
      if (usernames.length === 0) {
        return ctx.reply('❗ Список пуст. Введите username через запятую.');
      }

      try {
        const queue = await knex('queues').where({ id: queueId, admin_id: userId }).first();
        if (!queue) {
          adminStates.delete(key);
          return ctx.reply('Очередь не найдена или вы не админ.');
        }

        const countObj = await knex('participants').where({ queue_id: queueId }).count('id as count').first();
        let pos = countObj.count || 0;

        let addedUsers = [];
        for (const username of usernames) {
          const existingUser = await knex('users').where('username', username.toLowerCase()).first();
          const userIdToInsert = existingUser ? existingUser.user_id : null;

          await knex('participants').insert({
            queue_id: queueId,
            user_id: userIdToInsert,
            username,
            position: pos,
            status: 'waiting',
          });

          addedUsers.push(username);
        }
        adminStates.delete(key);
        await ctx.reply(`✅ Добавлены пользователи: ${addedUsers.map((u) => '@' + u).join(', ')}`);

        // Возврат в панель управления
        await ctx.reply(`🔧 Панель управления очередью "${queue.title}"`, getAdminPanelKeyboard(queueId));
      } catch (e) {
        adminStates.delete(key);
        log('Ошибка при добавлении пользователей:', e);
        await ctx.reply('❌ Ошибка при добавлении пользователей.');
      }
      return;
    }

    if (state.type === 'awaiting_link') {
      const link = text.trim();
      if (!link.startsWith('http')) {
        return ctx.reply('❗ Введите корректную ссылку (начинается с http или https)');
      }
      try {
        const queue = await knex('queues').where({ id: queueId, admin_id: userId }).first();
        if (!queue) {
          adminStates.delete(key);
          return ctx.reply('Очередь не найдена или вы не админ.');
        }
        await knex('queues').where({ id: queueId }).update({ meet_link: link });
        adminStates.delete(key);
        await ctx.reply(`✅ Ссылка для очереди "${queue.title}" обновлена.`);

        // Возврат в панель управления
        await ctx.reply(`🔧 Панель управления очередью "${queue.title}"`, getAdminPanelKeyboard(queueId));
      } catch (e) {
        adminStates.delete(key);
        log('Ошибка при обновлении ссылки:', e);
        await ctx.reply('❌ Ошибка при обновлении ссылки.');
      }
      return;
    }
  }

  return next();
});

// --- /join @admin_username ---
bot.command('join', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  const adminUsername = args[0];
  const queueTitle = args.slice(1).join(' ');
  const userId = ctx.from.id;
  const username = ctx.from.username || null;

  if (!adminUsername || !adminUsername.startsWith('@')) {
    return ctx.reply('❗ Укажите username администратора. Например: /join @adminname [название очереди]');
  }

  try {
    const adminUsernameClean = adminUsername.slice(1).toLowerCase();
    const queuesQuery = knex('queues').whereRaw('lower(admin_username) = ?', [adminUsernameClean]);
    const queues = await queuesQuery;

    if (queues.length === 0) {
      return ctx.reply('❌ У администратора нет очередей.');
    }

    let queue;
    if (queueTitle) {
      queue = queues.find(q => q.title.toLowerCase() === queueTitle.toLowerCase());
      if (!queue) {
        return ctx.reply(`❌ Очередь "${queueTitle}" не найдена у @${adminUsernameClean}`);
      }
    } else {
      queue = queues[queues.length - 1]; // Последняя по времени создания
    }

    const existing = await knex('participants').where({ queue_id: queue.id, user_id: userId }).first();
    if (existing) {
      return ctx.reply(`❗ Вы уже участвуете в очереди "${queue.title}".`);
    }

    const maxPos = await knex('participants')
      .where({ queue_id: queue.id })
      .max('position as max')
      .first();

    const position = (maxPos.max || 0) + 1;
    await knex('participants').insert({
      queue_id: queue.id,
      user_id: userId,
      username,
      position,
      status: 'waiting',
    });

    await ctx.reply(`✅ Вы добавлены в очередь "${queue.title}".`);
  } catch (e) {
    log('Ошибка в /join:', e);
    await ctx.reply('❌ Ошибка при присоединении.');
  }
});

// --- /mystatus ---
bot.command('mystatus', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const participations = await knex('participants')
      .join('queues', 'participants.queue_id', 'queues.id')
      .where('participants.user_id', userId)
      .select(
        'queues.title as queue_title',
        'participants.position',
        'participants.status'
      );

    if (participations.length === 0) {
      return ctx.reply('Вы ни в одной очереди не состоите.');
    }

    let text = '📋 Ваши текущие очереди:\n\n';
    for (const p of participations) {
      text += `• "${p.queue_title}": позиция ${p.position}, статус — ${p.status}\n`;
    }
    await ctx.reply(text);
  } catch (e) {
    log('Ошибка в /mystatus:', e);
    await ctx.reply('❌ Ошибка при получении статуса.');
  }
});

// --- /adminpanel ---
bot.command('adminpanel', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const queues = await knex('queues').where({ admin_id: userId }).orderBy('created_at', 'desc');
    if (queues.length === 0) {
      return ctx.reply('❌ У вас нет созданных очередей. Создайте через /createqueue');
    }
    const buttons = queues.map((q) => [Markup.button.callback(q.title, `ADMIN_QUEUE_${q.id}`)]);
    await ctx.reply('Ваши очереди:', Markup.inlineKeyboard(buttons));
    log(`Админ ${userId} открыл панель управления`);
  } catch (e) {
    log('Ошибка в /adminpanel:', e);
    await ctx.reply('❌ Ошибка при загрузке панелей.');
  }
});

// --- Инициализация и запуск ---
(async () => {
  await initDB();
  await setCommands();
  bot.launch();
  log('Бот запущен');
})();

// --- Обработка ошибок ---
bot.catch((err, ctx) => {
  log(`Ошибка в боте для пользователя ${ctx.from?.id}:`, err);
});
