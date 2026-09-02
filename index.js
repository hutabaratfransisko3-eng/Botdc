const { 
  Client: BotClient, 
  GatewayIntentBits, 
  REST, 
  Routes, 
  SlashCommandBuilder, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle, 
  ActionRowBuilder 
} = require('discord.js');

const { Client: SelfbotClient } = require('discord.js-selfbot-v13');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

let userToken = process.env.USER_TOKEN || null;
let targetChannelId = process.env.TARGET_CHANNEL_ID || null;

let pendingCS = null;
let isSent = false; 
let originChannel = null;

const bot = new BotClient({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ] 
});

const commands = [
  new SlashCommandBuilder().setName('setakun').setDescription('Set User Token').addStringOption(o => o.setName('token').setDescription('Token Akun').setRequired(true)),
  new SlashCommandBuilder().setName('setchannelcs').setDescription('Set ID Channel CS').addStringOption(o => o.setName('channel_id').setDescription('ID Channel').setRequired(true)),
  new SlashCommandBuilder().setName('kirimcs').setDescription('Formulir Character Story')
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('[BOT] Commands terdaftar.');
  } catch (e) {
    console.error(e);
  }
})();

bot.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'setakun') {
      userToken = interaction.options.getString('token');
      return interaction.reply({ content: '✅ User Token berhasil disimpan!', ephemeral: true });
    }
    if (interaction.commandName === 'setchannelcs') {
      targetChannelId = interaction.options.getString('channel_id');
      return interaction.reply({ content: `✅ Channel target di-set ke: \`${targetChannelId}\``, ephemeral: true });
    }
    if (interaction.commandName === 'kirimcs') {
      if (!userToken || !targetChannelId) {
        return interaction.reply({ content: '❌ Silakan set akun (`/setakun`) & channel (`/setchannelcs`) dulu!', ephemeral: true });
      }

      isSent = false;
      originChannel = interaction.channel;

      const modal = new ModalBuilder().setCustomId('csModal').setTitle('Formulir Character Story');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('namaIC').setLabel('Nama [IC]').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('umurIC').setLabel('Umur [IC]').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tglIC').setLabel('Tanggal Lahir [IC]').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('storyIC').setLabel('Story Character').setStyle(TextInputStyle.Paragraph).setRequired(true))
      );
      await interaction.showModal(modal);
    }
  }

  if (interaction.isModalSubmit() && interaction.customId === 'csModal') {
    await interaction.deferReply({ ephemeral: true });

    const nama = interaction.fields.getTextInputValue('namaIC');
    const umur = interaction.fields.getTextInputValue('umurIC');
    const tgl = interaction.fields.getTextInputValue('tglIC');
    const story = interaction.fields.getTextInputValue('storyIC');

    const contentMessage = 
`Nama [IC] : ${nama}
Umur [IC] : ${umur}
Tanggal lahir [IC sesuai Id card] : ${tgl}
Ss stats & Id card [Wajib] : ada
Ss Tab Level in Game [Wajib]: ada
Story : ${story}
Tag : <@&1212085960418791464>`;

    await interaction.editReply({ content: '📸 **Data CS tersimpan!** Kirimkan gambar screenshot (Stats/Tab Level) di room chat ini dalam 60 detik.' });

    const filter = m => m.author.id === interaction.user.id && m.attachments.size > 0;
    const collector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });

    collector.on('collect', async message => {
      const imageUrls = message.attachments.map(a => a.url);

      pendingCS = {
        content: contentMessage,
        files: imageUrls
      };

      await interaction.followUp({ 
        content: '⏳ **Mode Siaga Aktif!** CS akan otomatis dikirim begitu channel tujuan terdeteksi open.', 
        ephemeral: true 
      });

      if (message.deletable) await message.delete();
    });

    collector.on('end', collected => {
      if (collected.size === 0 && !pendingCS) {
        interaction.followUp({ content: '⏳ Waktu habis! Anda tidak mengunggah gambar.', ephemeral: true });
      }
    });
  }
});

// Penambahan kata kunci `async` pada fungsi penanganan pesan
bot.on('messageCreate', async message => {
  if (!pendingCS || isSent || message.channel.id !== targetChannelId) return;

  isSent = true; 
  console.log('[AUTO-SEND] Memulai pengiriman cepat...');

  const dataToSend = { ...pendingCS };
  pendingCS = null; 

  try {
    const selfClient = new SelfbotClient();

    selfClient.on('ready', async () => {
      try {
        const targetChannel = await selfClient.channels.fetch(targetChannelId);
        await targetChannel.send({
          content: dataToSend.content,
          files: dataToSend.files
        });

        const now = new Date();
        const timeString = now.toLocaleTimeString('id-ID', { 
          timeZone: 'Asia/Jakarta', 
          hour: '2-digit', 
          minute: '2-digit', 
          second: '2-digit' 
        });

        console.log(`[SUCCESS] CS dikirim pada jam ${timeString}`);

        if (originChannel) {
          await originChannel.send(`✅ **CS Berhasil dikirim pada jam ${timeString} WIB**`);
        }

        selfClient.destroy();
      } catch (err) {
        console.error('[ERROR] Selfbot gagal mengirim:', err);
        if (originChannel) {
          await originChannel.send(`❌ **Gagal mengirim CS:** ${err.message}`);
        }
        selfClient.destroy();
      }
    });

    // Menangani promise login secara eksplisit
    selfClient.login(userToken).catch(err => {
      console.error('[ERROR] Selfbot login gagal:', err);
      if (originChannel) {
        originChannel.send(`❌ **Gagal login akun user:** ${err.message}`);
      }
    });
  } catch (err) {
    console.error('[ERROR] Jalur eksekusi error:', err);
  }
});

bot.login(BOT_TOKEN);
