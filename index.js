const { Client, GatewayIntentBits, Partials } = require('discord.js');
const axios = require('axios');

// Mengambil token dari Environment Variables Railway
const BOT_TOKEN = process.env.BOT_TOKEN;
const USER_TOKEN = process.env.USER_TOKEN;

if (!BOT_TOKEN || !USER_TOKEN) {
    console.error("FATAL ERROR: BOT_TOKEN atau USER_TOKEN belum diatur di Environment Variables!");
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// Database Sementara (Akan reset jika server/Railway direstart)
let operatorChannelId = null;
let targetChannelId = null;
let messageQueue = [];
let isStandby = false;

// Fungsi untuk mengirim pesan sebagai User Account
async function sendAsUser(channelId, content) {
    try {
        await axios.post(
            `https://discord.com/api/v10/channels/${channelId}/messages`,
            { content: content },
            { headers: { 'Authorization': USER_TOKEN, 'Content-Type': 'application/json' } }
        );
        return true;
    } catch (error) {
        console.error("Gagal mengirim sebagai user:", error.response ? error.response.data : error.message);
        return false;
    }
}

// Fungsi untuk memproses antrean pesan
async function processQueue() {
    if (messageQueue.length === 0 || !targetChannelId) return;

    const targetChannel = client.channels.cache.get(targetChannelId);
    if (!targetChannel) return;

    // Cek apakah channel terbuka (memiliki izin SEND_MESSAGES untuk everyone/role default)
    const canSend = targetChannel.permissionsFor(targetChannel.guild.id).has('SendMessages');

    if (!canSend) {
        if (!isStandby) {
            isStandby = true;
            if (operatorChannelId) {
                const opChannel = client.channels.cache.get(operatorChannelId);
                if (opChannel) opChannel.send("⚠️ **Mode Siaga Aktif:** Chanel target belum dibuka. Pesan masuk antrean.");
            }
        }
        return; 
    }

    // Jika channel terbuka, kirim semua antrean
    isStandby = false;
    let successCount = 0;

    while (messageQueue.length > 0) {
        const msgContent = messageQueue[0]; 
        const success = await sendAsUser(targetChannelId, msgContent);
        
        if (success) {
            messageQueue.shift(); // Hapus dari antrean jika berhasil
            successCount++;
        } else {
            break; // Jika gagal (rate limit dll), berhenti sejenak
        }
    }

    if (successCount > 0 && operatorChannelId) {
        const opChannel = client.channels.cache.get(operatorChannelId);
        if (opChannel) {
            opChannel.send(`✅ **Berhasil:** ${successCount} pesan dari antrean telah berhasil dikirim otomatis!`);
        }
    }
}

client.on('ready', () => {
    console.log(`Bot pengelola aktif sebagai ${client.user.tag}`);
    // Mengecek antrean setiap 5 detik
    setInterval(processQueue, 5000);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content.startsWith('/setchoperator')) {
        operatorChannelId = message.channel.id;
        return message.reply(`✅ Chanel ini telah diatur sebagai **Chanel Operator**.`);
    }

    if (message.content.startsWith('/settarget')) {
        const args = message.content.split(' ');
        if (!args[1]) return message.reply("❌ Masukkan ID Chanel! Contoh: `/settarget 1234567890`");
        
        targetChannelId = args[1];
        return message.reply(`✅ Chanel target pengiriman diatur ke: <#${targetChannelId}>`);
    }

    if (message.content.startsWith('/startkirim')) {
        if (!operatorChannelId) return message.reply("❌ Setel Chanel Operator terlebih dahulu dengan `/setchoperator`");
        if (!targetChannelId) return message.reply("❌ Setel Chanel Target terlebih dahulu dengan `/settarget <ID>`");
        
        if (!message.reference || !message.reference.messageId) {
            return message.reply("❌ Anda harus me-reply sebuah pesan lalu ketik `/startkirim`.");
        }

        try {
            const repliedMsg = await message.channel.messages.fetch(message.reference.messageId);
            
            let finalContent = repliedMsg.content || "";
            if (repliedMsg.attachments.size > 0) {
                const attachmentUrls = repliedMsg.attachments.map(a => a.url).join('\n');
                finalContent += `\n${attachmentUrls}`; 
            }

            if (!finalContent) return message.reply("❌ Pesan yang di-reply kosong atau tidak valid.");

            messageQueue.push(finalContent);
            message.reply("⏳ Pesan dimasukkan ke sistem. Sedang mengecek status channel...");
            
            await processQueue();

        } catch (error) {
            console.error(error);
            message.reply("❌ Terjadi kesalahan saat memproses pesan.");
        }
    }
});

// Trigger pengecekan otomatis saat permission channel diubah
client.on('channelUpdate', (oldChannel, newChannel) => {
    if (newChannel.id === targetChannelId) {
        processQueue(); 
    }
});

client.login(BOT_TOKEN);
