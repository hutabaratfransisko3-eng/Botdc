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

const BOT_TOKEN = process.env.BOT_TOKEN ? process.env.BOT_TOKEN.replace(/['"]/g, '').trim() : null;
const CLIENT_ID = process.env.CLIENT_ID ? process.env.CLIENT_ID.replace(/['"]/g, '').trim() : null;

let userToken = process.env.USER_TOKEN ? process.env.USER_TOKEN.replace(/['"]/g, '').trim() : null;
let targetChannelId = process.env.TARGET_CHANNEL_ID ? process.env.TARGET_CHANNEL_ID.replace(/['"]/g, '').trim() : null;

const bot = new BotClient({ 
  intents: [ GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent ] 
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
      userToken = interaction.options.getString('token').trim();
      return interaction.reply({ content: '✅ User Token disimpan sementara!', ephemeral: true });
    }
    if (interaction.commandName === 'setchannelcs') {
      targetChannelId = interaction.options.getString('channel_id').trim();
      return interaction.reply({ content: `✅ Channel target sementara: \`${targetChannelId}\``, ephemeral: true });
    }
    if (interaction.commandName === 'kirimcs') {
      if (!userToken || !targetChannelId) {
        return interaction.reply({ content: '❌ Token Akun atau ID Channel belum diset!', ephemeral: true });
      }

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

    const contentMessage = `Nama [IC] : ${nama}\nUmur [IC] : ${umur}\nTanggal lahir [IC sesuai Id card] : ${tgl}\nSs stats & Id card [Wajib] : ada\nSs Tab Level in Game [Wajib]: ada\nStory : ${story}\nTag : <@&1212085960418791464>`;

    await interaction.editReply({ content: '📸 **Data CS tersimpan!** Kirimkan gambar screenshot (Stats/Tab Level) di room chat ini dalam 60 detik.' });

    const filter = m => m.author.id === interaction.user.id && m.attachments.size > 0;
    const collector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });
    
    let isImageCollected = false;

    collector.on('collect', async message => {
      isImageCollected = true;
      const imageUrls = message.attachments.map(a => a.url);
      const originChannel = interaction.channel;
      
      await interaction.followUp({ content: '🚀 Gambar diterima, memulai eksekusi bot...', ephemeral: true });
      if (message.deletable) await message.delete();

      const statusMsg = await originChannel.send('🔄 **[Sistem]** Menginisialisasi login ke akun...');

      try {
        const selfClient = new SelfbotClient({ checkUpdate: false });
        let isSent = false;

        const attemptSend = async () => {
          if (isSent) return;
          try {
            await statusMsg.edit(`🔄 **[Sistem]** Mencari channel target: \`${targetChannelId}\`...`);
            const targetChannel = await selfClient.channels.fetch(targetChannelId);
            
            if (!targetChannel) {
              await statusMsg.edit('❌ **[Error]** Channel target tidak ditemukan! Pastikan ID Channel benar.');
              selfClient.destroy();
              return;
            }

            await statusMsg.edit(`🔄 **[Sistem]** Channel ditemukan! Mencoba mengirim formulir CS...`);
            await targetChannel.send({ content: contentMessage, files: imageUrls });
            isSent = true;
            
            const timeString = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit' });
            await statusMsg.edit(`✅ **CS Berhasil dikirim pada jam ${timeString} WIB**`);
            selfClient.destroy();
          } catch (err) {
            if (err.code !== 50013) { 
              console.error(err);
              await statusMsg.edit(`❌ **[Error Pengiriman]** ${err.message}`);
              selfClient.destroy();
            } else {
              await statusMsg.edit(`⏳ **[Mode Siaga]** Channel masih di-lock (Terkunci). Menunggu ada admin yang buka channel...`);
            }
          }
        };

        selfClient.on('ready', async () => {
          await statusMsg.edit(`✅ **[Sistem]** Berhasil login sebagai: \`${selfClient.user.tag}\`. Memulai proses...`);
          await attemptSend(); 
        });

        selfClient.on('messageCreate', async msg => {
          if (msg.channel.id === targetChannelId) await attemptSend();
        });

        selfClient.on('channelUpdate', async (oldCh, newCh) => {
          if (newCh.id === targetChannelId) await attemptSend();
        });

        await selfClient.login(userToken).catch(async err => {
          console.error(err);
          await statusMsg.edit(`❌ **[Error Login]** Gagal login! Pastikan token akun BENAR.\n*Log: ${err.message}*`);
        });

      } catch (err) {
        await statusMsg.edit(`❌ **[Error Fatal]** Terjadi kesalahan pada sistem: ${err.message}`);
      }
    });

    collector.on('end', async () => {
      if (!isImageCollected) {
        await interaction.followUp({ content: '⏳ Waktu habis! Kamu tidak mengirimkan gambar tepat waktu.', ephemeral: true });
      }
    });
  }
});

bot.login(BOT_TOKEN);            await statusMsg.edit(`🔄 **[Sistem]** Mencari channel target: \`${targetChannelId}\`...`);
            const targetChannel = await selfClient.channels.fetch(targetChannelId);
            
            if (!targetChannel) {
              await statusMsg.edit('❌ **[Error]** Channel target tidak ditemukan! Pastikan ID Channel benar dan akun masuk ke server.');
              selfClient.destroy();
              return;
            }

            await statusMsg.edit(`🔄 **[Sistem]** Channel ditemukan! Mencoba mengirim formulir CS...`);
            await targetChannel.send({ content: contentMessage, files: imageUrls });
            isSent = true;
            
            const timeString = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit' });
            await statusMsg.edit(`✅ **CS Berhasil dikirim pada jam ${timeString} WIB**`);
            selfClient.destroy();
          } catch (err) {
            if (err.code !== 50013) { 
              console.error(err);
              await statusMsg.edit(`❌ **[Error Pengiriman]** ${err.message}`);
              selfClient.destroy();
            } else {
              await statusMsg.edit(`⏳ **[Mode Siaga]** Channel masih di-lock (Terkunci). Menunggu ada admin yang buka channel...`);
            }
          }
        };

        selfClient.on('ready', async () => {
          await statusMsg.edit(`✅ **[Sistem]** Berhasil login sebagai: \`${selfClient.user.tag}\`. Memulai proses...`);
          await attemptSend(); 
        });

        selfClient.on('messageCreate', async msg => {
          if (msg.channel.id === targetChannelId) await attemptSend();
        });

        selfClient.on('channelUpdate', async (oldCh, newCh) => {
          if (newCh.id === targetChannelId) await attemptSend();
        });

        await selfClient.login(userToken).catch(async err => {
          console.error(err);
          await statusMsg.edit(`❌ **[Error Login]** Gagal login! Pastikan token akun BENAR dan belum kadaluwarsa (ambil ulang di browser).\n*Log: ${err.message}*`);
        });

      } catch (err) {
        await statusMsg.edit(`❌ **[Error Fatal]** Terjadi kesalahan pada sistem: ${err.message}`);
      }
    });

    collector.on('end', async () => {
      if (!isImageCollected) {
        await interaction.followUp({ content: '⏳ Waktu habis! Kamu tidak mengirimkan gambar tepat waktu.', ephemeral: true });
      }
    });
  }
});

bot.login(BOT_TOKEN);              selfClient.destroy();
            }
          }
        };

        selfClient.on('ready', async () => {
          console.log(`[SELFBOT] Login sebagai ${selfClient.user.tag}`);
          await attemptSend(); 
        });

        selfClient.on('messageCreate', async msg => {
          if (msg.channel.id === targetChannelId) await attemptSend();
        });

        selfClient.on('channelUpdate', async (oldCh, newCh) => {
          if (newCh.id === targetChannelId) await attemptSend();
        });

        await selfClient.login(userToken);
      } catch (err) {
        await originChannel.send(`❌ **Gagal login akun user:** ${err.message}`);
      }
    });

    // Menambahkan 'async' di sini untuk memperbaiki crash di baris 135
    collector.on('end', async () => {
      if (!isImageCollected) {
        await interaction.followUp({ content: '⏳ Waktu habis! Anda tidak mengunggah gambar dalam waktu 60 detik.', ephemeral: true });
      }
    });
  }
});

bot.login(BOT_TOKEN);
