const { Client } = require('discord.js-selfbot-v13');

const USER_TOKEN = process.env.USER_TOKEN ? process.env.USER_TOKEN.replace(/['"]/g, '').trim() : null;
const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID ? process.env.TARGET_CHANNEL_ID.replace(/['"]/g, '').trim() : null;

if (!USER_TOKEN || !TARGET_CHANNEL_ID) {
  console.error('❌ Set USER_TOKEN dan TARGET_CHANNEL_ID di Environment Railway!');
  process.exit(1);
}

const client = new Client({ checkUpdate: false });

let pendingCS = null;
let isSent = false;

client.on('ready', () => {
  console.log(`[SELFBOT READY] Login sebagai: ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  // 1. INPUT CS (Ketik dari akunmu sendiri di DM / mana saja)
  if (message.author.id === client.user.id && message.content.startsWith('.cs')) {
    const rawText = message.content.slice(3).trim();
    const args = rawText.split('|').map(item => item.trim());

    // Validasi input & lampiran gambar
    if (args.length < 4 || message.attachments.size === 0) {
      return message.reply('❌ **Format Salah!**\n\n**Cara Pakai:** Ketik `.cs Nama IC | Umur IC | Tgl Lahir | Story CS` lalu **upload/lampirkan foto screenshot** di pesan yang sama.');
    }

    const [nama, umur, tgl, story] = args;
    const imageUrls = message.attachments.map(a => a.url);

    pendingCS = {
      content: `Nama [IC] : ${nama}\nUmur [IC] : ${umur}\nTanggal lahir [IC sesuai Id card] : ${tgl}\nSs stats & Id card [Wajib] : ada\nSs Tab Level in Game [Wajib]: ada\nStory : ${story}\nTag : <@&1212085960418791464>`,
      files: imageUrls
    };

    isSent = false;
    console.log('[SELFBOT] Data CS tersimpan dan masuk Mode Siaga.');
    return message.reply('⏳ **[Mode Siaga Aktif]** Data CS & Gambar tersimpan! Akan otomatis terkirim begitu ada aktivitas di channel target.');
  }

  // 2. AUTO SEND (Mendeteksi saat channel target OPEN)
  if (pendingCS && !isSent && message.channel.id === TARGET_CHANNEL_ID) {
    isSent = true;
    console.log('[SELFBOT] Channel target terdeteksi aktif! Mengirim CS...');

    try {
      const targetChannel = await client.channels.fetch(TARGET_CHANNEL_ID);
      await targetChannel.send({
        content: pendingCS.content,
        files: pendingCS.files
      });

      const timeString = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      console.log(`[BERHASIL] CS terkirim pada jam ${timeString} WIB`);

      // Kirim konfirmasi ke DM kamu
      await client.users.cache.get(client.user.id)?.send(`✅ **CS Berhasil dikirim pada jam ${timeString} WIB**`);
      pendingCS = null;
    } catch (err) {
      console.error('[GAGAL KIRIM]', err);
      isSent = false; // Reset jika gagal agar bisa coba lagi
    }
  }
});

client.login(USER_TOKEN).catch(err => {
  console.error('❌ Gagal login token akun:', err.message);
});              return;
            }

            await statusMsg.edit(`🔄 **[Sistem]** Channel ditemukan! Mencoba mengirim formulir CS...`);
            await targetChannel.send({ content: contentMessage, files: imageUrls });
            isSent = true;
            
            const timeString = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit' });
            await statusMsg.edit(`✅ **CS Berhasil dikirim pada jam ${timeString} WIB**`);
            selfClient.destroy();
          } catch (err) {
            if (err.code !== 50013) { 
              console.error('[SEND ERROR]', err);
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
          console.error('[LOGIN ERROR]', err);
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

bot.login(BOT_TOKEN);
