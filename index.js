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

// Ambil Token Bot Utama dari Environment Variable Railway
const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

let userToken = process.env.USER_TOKEN || null;
let targetChannelId = process.env.TARGET_CHANNEL_ID || null;

const bot = new BotClient({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder()
    .setName('setakun')
    .setDescription('Mengatur User Token akun pribadi')
    .addStringOption(opt => opt.setName('token').setDescription('Token Akun User').setRequired(true)),
        
  new SlashCommandBuilder()
    .setName('setchannelcs')
    .setDescription('Mengatur ID Channel tujuan')
    .addStringOption(opt => opt.setName('channel_id').setDescription('ID Channel').setRequired(true)),
        
  new SlashCommandBuilder()
    .setName('kirimcs')
    .setDescription('Membuka form penginputan data CS')
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('[BOT] Slash Commands terdaftar.');
  } catch (err) {
    console.error('[BOT ERROR] Gagal mendaftarkan command:', err);
  }
})();

bot.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'setakun') {
      userToken = interaction.options.getString('token');
      await interaction.reply({ content: '✅ User Token berhasil disimpan sementara!', ephemeral: true });
    }

    if (interaction.commandName === 'setchannelcs') {
      targetChannelId = interaction.options.getString('channel_id');
      await interaction.reply({ content: `✅ ID Channel tujuan di-set ke: \`${targetChannelId}\``, ephemeral: true });
    }

    if (interaction.commandName === 'kirimcs') {
      if (!userToken || !targetChannelId) {
        return interaction.reply({ 
          content: '❌ Silakan set akun (`/setakun`) dan channel (`/setchannelcs`) terlebih dahulu!', 
          ephemeral: true 
        });
      }

      const modal = new ModalBuilder()
        .setCustomId('csModal')
        .setTitle('Formulir Character Story');

      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('namaIC').setLabel('Nama [IC]').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('umurIC').setLabel('Umur [IC]').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tglIC').setLabel('Tanggal Lahir [IC]').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('imgUrls').setLabel('URL Gambar Stats & Tab (Pisah Koma)').setStyle(TextInputStyle.Short).setRequired(true)),
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
    const imgUrlsRaw = interaction.fields.getTextInputValue('imgUrls');
    const story = interaction.fields.getTextInputValue('storyIC');

    const attachmentArray = imgUrlsRaw.split(',').map(url => url.trim());

    const contentMessage = 
`Nama [IC] : ${nama}
Umur [IC] : ${umur}
Tanggal lahir [IC sesuai Id card] : ${tgl}
Ss stats & Id card [Wajib] : ada
Ss Tab Level in Game [Wajib]: ada
Story : ${story}
Tag : <@&1212085960418791464>`;

    try {
      const selfClient = new SelfbotClient();
      
      selfClient.on('ready', async () => {
        try {
          const channel = await selfClient.channels.fetch(targetChannelId);
          await channel.send({ content: contentMessage, files: attachmentArray });

          await interaction.editReply({ content: '🚀 CS Berhasil dikirimkan menggunakan akun Anda!' });
          selfClient.destroy();
        } catch (err) {
          await interaction.editReply({ content: `❌ Gagal mengirim pesan: ${err.message}` });
          selfClient.destroy();
        }
      });

      await selfClient.login(userToken);
    } catch (err) {
      await interaction.editReply({ content: `❌ Token tidak valid / Gagal login: ${err.message}` });
    }
  }
});

bot.login(BOT_TOKEN);