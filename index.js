const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder } = require('discord.js');
const axios = require('axios');

const BOT_TOKEN = process.env.BOT_TOKEN;
const USER_TOKEN = process.env.USER_TOKEN;

if (!BOT_TOKEN || !USER_TOKEN) {
    console.error("FATAL ERROR: BOT_TOKEN atau USER_TOKEN belum diatur!");
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

let operatorChannelId = null;
let targetChannelId = null;
let messageQueue = [];
let isStandby = false;
let isProcessing = false;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const commands = [
    new SlashCommandBuilder()
        .setName('setchoperator')
        .setDescription('Mengatur channel ini sebagai channel operator bot'),
    new SlashCommandBuilder()
        .setName('settarget')
        .setDescription('Mengatur channel target pengiriman')
        .addStringOption(option => 
            option.setName('channel_id')
                .setDescription('ID Channel Tujuan')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('startkirim')
        .setDescription('Kirim pesan berdasarkan ID pesan')
        .addStringOption(option =>
            option.setName('message_id')
                .setDescription('ID Pesan yang ingin diteruskan')
                .setRequired(true))
].map(command => command.toJSON());

async function registerCommands(clientId) {
    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
        console.log('Slash Commands berhasil terdaftar!');
    } catch (error) {
        console.error('Gagal mendaftarkan Slash Commands:', error.message);
    }
}

// Fungsi kirim pesan via User API
async function sendAsUser(channelId, content) {
    try {
        await axios.post(
            `https://discord.com/api/v10/channels/${channelId}/messages`,
            { content: content },
            { 
                headers: { 
                    'Authorization': USER_TOKEN, 
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                } 
            }
        );
        return { success: true };
    } catch (error) {
        const errorData = error.response ? error.response.data : error.message;
        console.error("[RAILWAY LOG ERROR]", JSON.stringify(errorData)); // Log error HANYA muncul di Railway
        return { success: false };
    }
}

async function processQueue() {
    // Jika sedang memproses atau antrean kosong, langsung lewati tanpa kirim log apa pun
    if (isProcessing || messageQueue.length === 0 || !targetChannelId) return;

    isProcessing = true;
    const targetChannel = client.channels.cache.get(targetChannelId);
    
    if (!targetChannel) {
        console.log(`[RAILWAY LOG] Bot tidak bisa melihat channel target ID: ${targetChannelId}`);
        isProcessing = false;
        return; 
    }

    // Cek apakah channel terbuka (dapat mengirim pesan)
    const canSend = targetChannel.permissionsFor(targetChannel.guild.id).has('SendMessages');

    if (!canSend) {
        // Hanya beri notifikasi Sekali saat pertama kali masuk mode siaga
        if (!isStandby) {
            isStandby = true;
            console.log(`[RAILWAY LOG] Channel ${targetChannelId} tertutup. Mode Siaga Aktif.`);
            if (operatorChannelId) {
                const opChannel = client.channels.cache.get(operatorChannelId);
                if (opChannel) opChannel.send(`⚠️ **Mode Siaga Aktif:** Channel <#${targetChannelId}> dikunci. Pesan disimpan dalam antrean.`);
            }
        }
        isProcessing = false;
        return; 
    }

    // Jika channel terbuka
    isStandby = false;
    let successCount = 0;

    while (messageQueue.length > 0) {
        const msgContent = messageQueue[0]; 
        const result = await sendAsUser(targetChannelId, msgContent);
        
        if (result.success) {
            messageQueue.shift(); // Hapus dari antrean
            successCount++;
            
            // Jeda singkat acak (2-3 detik) antar pesan dalam antrean agar akun aman dari ban
            if (messageQueue.length > 0) {
                const randomDelay = Math.floor(Math.random() * 1000) + 2000;
                await sleep(randomDelay);
            }
        } else {
            console.log(`[RAILWAY LOG] Gagal mengirim pesan ke target. Proses antrean dihentikan.`);
            break;
        }
    }

    // Kirim notifikasi HANYA 1 kali di Discord saat seluruh pengiriman selesai
    if (successCount > 0 && operatorChannelId) {
        const opChannel = client.channels.cache.get(operatorChannelId);
        if (opChannel) {
            opChannel.send(`✅ **Berhasil:** ${successCount} pesan berhasil dikirim ke <#${targetChannelId}>!`);
        }
    }

    isProcessing = false;
}

client.on('ready', async () => {
    console.log(`Bot pengelola aktif sebagai ${client.user.tag}`);
    await registerCommands(client.user.id);
    // Pengecekan status secara berkala setiap 5 detik tanpa spam log
    setInterval(processQueue, 5000);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    if (commandName === 'setchoperator') {
        operatorChannelId = interaction.channelId;
        await interaction.reply({ content: `✅ Channel operator diatur ke: <#${operatorChannelId}>` });
    }

    else if (commandName === 'settarget') {
        targetChannelId = interaction.options.getString('channel_id');
        await interaction.reply({ content: `✅ Channel target diatur ke: <#${targetChannelId}>` });
    }

    else if (commandName === 'startkirim') {
        if (!operatorChannelId) return interaction.reply({ content: "❌ Setel channel operator dulu pakai `/setchoperator`", flags: 64 });
        if (!targetChannelId) return interaction.reply({ content: "❌ Setel channel target dulu pakai `/settarget`", flags: 64 });

        const msgId = interaction.options.getString('message_id');
        
        try {
            const targetMsg = await interaction.channel.messages.fetch(msgId);
            
            let finalContent = targetMsg.content || "";
            if (targetMsg.attachments.size > 0) {
                const attachmentUrls = targetMsg.attachments.map(a => a.url).join('\n');
                finalContent += `\n${attachmentUrls}`; 
            }

            if (!finalContent) return interaction.reply({ content: "❌ Pesan tersebut kosong!", flags: 64 });

            messageQueue.push(finalContent);
            await interaction.reply({ content: `⏳ Pesan ditambahkan ke antrean. Memproses...`, flags: 64 });
            
            // Langsung eksekusi saat itu juga jika channel terbuka
            processQueue();

        } catch (err) {
            await interaction.reply({ content: `❌ ID Pesan \`${msgId}\` tidak ditemukan di channel ini!`, flags: 64 });
        }
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.content === '!startkirim' || message.content === '.startkirim') {
        if (!operatorChannelId) return message.reply("❌ Setel channel operator dulu pakai `/setchoperator`!");
        if (!targetChannelId) return message.reply("❌ Setel channel target dulu pakai `/settarget`!");

        if (!message.reference || !message.reference.messageId) {
            return message.reply("❌ Balas (reply) pesan yang mau dikirim lalu ketik `!startkirim`!");
        }

        try {
            const targetMsg = await message.channel.messages.fetch(message.reference.messageId);

            let finalContent = targetMsg.content || "";
            if (targetMsg.attachments.size > 0) {
                const attachmentUrls = targetMsg.attachments.map(a => a.url).join('\n');
                finalContent += `\n${attachmentUrls}`; 
            }

            if (!finalContent) return message.reply("❌ Pesan tersebut kosong.");

            messageQueue.push(finalContent);
            message.reply("⏳ Pesan ditambahkan ke antrean. Memproses...");
            
            // Langsung eksekusi saat itu juga jika channel terbuka
            processQueue();

        } catch (err) {
            message.reply("❌ Gagal mengambil pesan yang di-reply.");
        }
    }
});

// Otomatis langsung eksekusi pesan saat ada perubahan/pembukaan channel target
client.on('channelUpdate', (oldChannel, newChannel) => {
    if (newChannel.id === targetChannelId) {
        processQueue(); 
    }
});

client.login(BOT_TOKEN);        
        if (success) {
            messageQueue.shift();
            successCount++;
        } else {
            if (operatorChannelId) {
                const opChannel = client.channels.cache.get(operatorChannelId);
                if (opChannel) opChannel.send(`❌ **Gagal:** Token User ditolak/invalid atau terkena Rate Limit API Discord. Cek log Railway!`);
            }
            break;
        }
    }

    if (successCount > 0 && operatorChannelId) {
        const opChannel = client.channels.cache.get(operatorChannelId);
        if (opChannel) {
            opChannel.send(`✅ **Berhasil:** ${successCount} pesan telah dikirim oleh akun User Anda!`);
        }
    }
}

client.on('ready', async () => {
    console.log(`Bot pengelola aktif sebagai ${client.user.tag}`);
    await registerCommands(client.user.id);
    setInterval(processQueue, 3000);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    if (commandName === 'setchoperator') {
        operatorChannelId = interaction.channelId;
        await interaction.reply(`✅ Channel operator diatur ke: <#${operatorChannelId}>`);
    }

    else if (commandName === 'settarget') {
        targetChannelId = interaction.options.getString('channel_id');
        await interaction.reply(`✅ Channel target diatur ke: <#${targetChannelId}>`);
    }

    else if (commandName === 'startkirim') {
        if (!operatorChannelId) return interaction.reply({ content: "❌ Setel channel operator dulu pakai `/setchoperator`", ephemeral: true });
        if (!targetChannelId) return interaction.reply({ content: "❌ Setel channel target dulu pakai `/settarget`", ephemeral: true });

        const msgId = interaction.options.getString('message_id');
        
        try {
            const targetMsg = await interaction.channel.messages.fetch(msgId);
            
            let finalContent = targetMsg.content || "";
            if (targetMsg.attachments.size > 0) {
                const attachmentUrls = targetMsg.attachments.map(a => a.url).join('\n');
                finalContent += `\n${attachmentUrls}`; 
            }

            if (!finalContent) return interaction.reply({ content: "❌ Pesan tersebut kosong!", ephemeral: true });

            messageQueue.push(finalContent);
            await interaction.reply(`⏳ Pesan (ID: \`${msgId}\`) masuk antrean. Memproses...`);
            await processQueue();

        } catch (err) {
            await interaction.reply({ content: `❌ ID Pesan \`${msgId}\` tidak ditemukan di channel ini!`, ephemeral: true });
        }
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.content === '!startkirim' || message.content === '.startkirim') {
        if (!operatorChannelId) return message.reply("❌ Setel channel operator dulu pakai `/setchoperator`!");
        if (!targetChannelId) return message.reply("❌ Setel channel target dulu pakai `/settarget`!");

        if (!message.reference || !message.reference.messageId) {
            return message.reply("❌ Balas (reply) pesan yang mau dikirim lalu ketik `!startkirim`!");
        }

        try {
            const targetMsg = await message.channel.messages.fetch(message.reference.messageId);

            let finalContent = targetMsg.content || "";
            if (targetMsg.attachments.size > 0) {
                const attachmentUrls = targetMsg.attachments.map(a => a.url).join('\n');
                finalContent += `\n${attachmentUrls}`; 
            }

            if (!finalContent) return message.reply("❌ Pesan tersebut kosong.");

            messageQueue.push(finalContent);
            message.reply("⏳ Pesan masuk antrean. Memproses...");
            await processQueue();

        } catch (err) {
            message.reply("❌ Gagal mengambil pesan yang di-reply.");
        }
    }
});

client.on('channelUpdate', (oldChannel, newChannel) => {
    if (newChannel.id === targetChannelId) {
        processQueue(); 
    }
});

client.login(BOT_TOKEN);
