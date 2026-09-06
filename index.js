const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const WebSocket = require('ws'); // Modul baru untuk titik hijau

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

// ---------------------------------------------------------
// FUNGSI GATEWAY WEBSOCKET (MENYALAKAN TITIK HIJAU AKUN)
// ---------------------------------------------------------
function keepUserOnline() {
    const ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');
    let heartbeatInterval = 0;

    ws.on('open', () => {
        console.log('[USER GATEWAY] Menghubungkan titik hijau akun User...');
    });

    ws.on('message', (data) => {
        const payload = JSON.parse(data);
        const { t, op, d } = payload;

        // Merespon detak jantung (heartbeat) dari Discord agar tidak diputus
        if (op === 10) {
            const { heartbeat_interval } = d;
            heartbeatInterval = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ op: 1, d: null }));
                }
            }, heartbeat_interval);

            // Mengirim identifikasi untuk memunculkan status Online
            ws.send(JSON.stringify({
                op: 2,
                d: {
                    token: USER_TOKEN,
                    capabilities: 16381,
                    properties: {
                        os: 'Windows',
                        browser: 'Chrome',
                        device: '',
                    },
                    presence: {
                        status: 'online',
                        since: 0,
                        activities: [],
                        afk: false
                    }
                }
            }));
        }

        if (t === 'READY') {
            console.log('[USER GATEWAY] ✅ Titik Hijau Akun User Aktif!');
        }
    });

    ws.on('close', () => {
        console.log('[USER GATEWAY] Koneksi terputus. Mencoba reconnect...');
        clearInterval(heartbeatInterval);
        setTimeout(keepUserOnline, 5000);
    });
    
    ws.on('error', (err) => {
        console.error('[USER GATEWAY ERROR]', err.message);
    });
}

// ---------------------------------------------------------
// FUNGSI PENEMBAK PESAN (AXIOS)
// ---------------------------------------------------------
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
        return { 
            success: false, 
            status: error.response?.status,
            code: error.response?.data?.code,
            data: error.response?.data
        };
    }
}

async function processQueue() {
    if (messageQueue.length === 0 || !targetChannelId) return;

    const msgContent = messageQueue[0]; 
    const result = await sendAsUser(targetChannelId, msgContent);
    
    if (result.success) {
        messageQueue.shift(); 
        isStandby = false;
        
        if (operatorChannelId) {
            const opChannel = client.channels.cache.get(operatorChannelId);
            if (opChannel) opChannel.send(`✅ **TARGET TERTEMBUS:** Pesan otomatis terkirim ke target!`);
        }
    } else {
        if (result.status === 403 || result.code === 50013 || result.code === 50001 || result.code === 50009) {
            if (!isStandby) {
                isStandby = true;
                if (operatorChannelId) {
                    const opChannel = client.channels.cache.get(operatorChannelId);
                    if (opChannel) opChannel.send(`⚠️ **Mode Siaga Aktif:** Channel <#${targetChannelId}> belum dibuka. Bot terus memantau dan siap menembak!`);
                }
            }
        } 
        else if (result.status === 401) {
            if (operatorChannelId && !isStandby) {
                const opChannel = client.channels.cache.get(operatorChannelId);
                if (opChannel) opChannel.send(`❌ **Gagal Kritis:** Token User Anda sudah kadaluarsa (401).`);
                isStandby = true;
            }
        } 
        else {
            console.log(`[RAILWAY LOG ERROR]`, JSON.stringify(result.data || "Unknown Error"));
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
        await interaction.reply({ content: `✅ Channel operator diatur ke: <#${operatorChannelId}>` });
    }
    else if (commandName === 'settarget') {
        targetChannelId = interaction.options.getString('channel_id');
        isStandby = false; 
        await interaction.reply({ content: `✅ Channel target diatur ke ID: \`${targetChannelId}\`` });
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
            await interaction.reply({ content: `⏳ Peluru disiapkan... Radar penembak diaktifkan.`, flags: 64 });
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
            message.reply("⏳ Peluru disiapkan... Radar penembak diaktifkan.");
            processQueue();

        } catch (err) {
            message.reply("❌ Gagal mengambil pesan yang di-reply.");
        }
    }
});

// Menjalankan koneksi WebSocket untuk titik hijau sebelum Bot login
keepUserOnline();
client.login(BOT_TOKEN);
