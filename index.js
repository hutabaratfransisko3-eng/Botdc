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
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Melihat status sistem, informasi akun user, dan antrean')
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

async function getUserProfile() {
    try {
        const response = await axios.get('https://discord.com/api/v10/users/@me', {
            headers: { 
                'Authorization': USER_TOKEN,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        const user = response.data;
        const tag = user.discriminator && user.discriminator !== '0' 
            ? `${user.username}#${user.discriminator}` 
            : user.username;
        return {
            valid: true,
            name: user.global_name ? `${user.global_name} (@${tag})` : `@${tag}`,
            id: user.id
        };
    } catch (error) {
        return { valid: false };
    }
}

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
                if (opChannel) opChannel.send(`❌ **Gagal Kritis:** Token User Anda tidak sah atau kadaluarsa (401).`);
                isStandby = true;
            }
        } 
        else {
            console.log(`[RAILWAY LOG ERROR]`, JSON.stringify(result.data || "Unknown Error"));
        }
    }
}

async function getStatusText() {
    const userProfile = await getUserProfile();
    
    const accountStatus = userProfile.valid 
        ? `🟢 Terhubung (${userProfile.name})` 
        : `🔴 Token Invalid / Terputus`;
        
    const modeStatus = isStandby ? `⚠️ Mode Siaga (Menunggu Channel Buka)` : `🟢 Normal / Siap`;
    const opChText = operatorChannelId ? `<#${operatorChannelId}>` : `❌ Belum di-set`;
    const targetChText = targetChannelId ? `<#${targetChannelId}> (\`${targetChannelId}\`)` : `❌ Belum di-set`;

    return `📊 **STATUS SISTEM BOT FORWARDER**\n` +
           `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
           `👤 **Akun Pengirim:** ${accountStatus}\n` +
           `🛠️ **Bot Pengelola:** ${client.user.tag}\n` +
           `📢 **Channel Operator:** ${opChText}\n` +
           `🎯 **Channel Target:** ${targetChText}\n` +
           `🔄 **Status Mode:** ${modeStatus}\n` +
           `📦 **Jumlah Antrean Pesan:** \`${messageQueue.length}\` Pesan\n` +
           `━━━━━━━━━━━━━━━━━━━━━━━━━`;
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
            
            // HANYA MENGAMBIL ISI TEKS UTAMA (Tanpa lampiran link attachment Discord)
            let finalContent = targetMsg.content || "";

            if (!finalContent) return interaction.reply({ content: "❌ Pesan tersebut kosong!", flags: 64 });

            messageQueue.push(finalContent);
            await interaction.reply({ content: `⏳ Peluru disiapkan... Radar penembak diaktifkan.`, flags: 64 });
            processQueue();

        } catch (err) {
            await interaction.reply({ content: `❌ ID Pesan \`${msgId}\` tidak ditemukan di channel ini!`, flags: 64 });
        }
    }
    else if (commandName === 'status') {
        await interaction.deferReply();
        const statusMsg = await getStatusText();
        await interaction.editReply({ content: statusMsg });
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.content === '!status' || message.content === '.status') {
        const statusMsg = await getStatusText();
        return message.reply(statusMsg);
    }

    if (message.content === '!startkirim' || message.content === '.startkirim') {
        if (!operatorChannelId) return message.reply("❌ Setel channel operator dulu pakai `/setchoperator`!");
        if (!targetChannelId) return message.reply("❌ Setel channel target dulu pakai `/settarget`!");

        if (!message.reference || !message.reference.messageId) {
            return message.reply("❌ Balas (reply) pesan yang mau dikirim lalu ketik `!startkirim`!");
        }

        try {
            const targetMsg = await message.channel.messages.fetch(message.reference.messageId);

            // HANYA MENGAMBIL ISI TEKS UTAMA (Tanpa lampiran link attachment Discord)
            let finalContent = targetMsg.content || "";

            if (!finalContent) return message.reply("❌ Pesan tersebut kosong.");

            messageQueue.push(finalContent);
            message.reply("⏳ Peluru disiapkan... Radar penembak diaktifkan.");
            processQueue();

        } catch (err) {
            message.reply("❌ Gagal mengambil pesan yang di-reply.");
        }
    }
});

client.login(BOT_TOKEN);
