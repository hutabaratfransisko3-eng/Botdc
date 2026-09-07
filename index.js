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
        .setDescription('Mengatur channel ini sebagai pusat kontrol bot'),
    new SlashCommandBuilder()
        .setName('settarget')
        .setDescription('Mengatur rute channel target transmisi')
        .addStringOption(option => 
            option.setName('channel_id')
                .setDescription('ID Channel Tujuan')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('startkirim')
        .setDescription('Eksekusi transmisi pesan ke target')
        .addStringOption(option =>
            option.setName('message_id')
                .setDescription('ID Pesan yang ingin ditransmisikan')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Tampilkan laporan diagnostik sistem')
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
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
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
            if (opChannel) opChannel.send(`**[ 🟢 UPLINK SUCCESS ]** | Transmisi data ke target berhasil dieksekusi.`);
        }
    } else {
        if (result.status === 403 || result.code === 50013 || result.code === 50001 || result.code === 50009) {
            if (!isStandby) {
                isStandby = true;
                if (operatorChannelId) {
                    const opChannel = client.channels.cache.get(operatorChannelId);
                    if (opChannel) opChannel.send(`**[ 🟡 SYSTEM STANDBY ]** | Akses ke <#${targetChannelId}> terkunci. Protokol pemantauan pasif diaktifkan. Pesan akan meluncur otomatis saat jalur terbuka.`);
                }
            }
        } 
        else if (result.status === 401) {
            if (operatorChannelId && !isStandby) {
                const opChannel = client.channels.cache.get(operatorChannelId);
                if (opChannel) opChannel.send(`**[ 🔴 CRITICAL ERROR ]** | Autentikasi ditolak (401). User Token kedaluwarsa atau tidak valid.`);
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
        ? `🟢 AKTIF (${userProfile.name})` 
        : `🔴 TERPUTUS / TOKEN INVALID`;
        
    const modeStatus = isStandby ? `🟡 SIAGA (MENDETEKSI JALUR)` : `🟢 NORMAL (SIAP TEMBAK)`;
    const opChText = operatorChannelId ? `<#${operatorChannelId}>` : `❌ NOT CONFIGURED`;
    const targetChText = targetChannelId ? `<#${targetChannelId}> (\`${targetChannelId}\`)` : `❌ NOT CONFIGURED`;

    return `\`\`\`ini\n[ SYSTEM DIAGNOSTIC REPORT ]\n\`\`\`` +
           `> **User Node:** ${accountStatus}\n` +
           `> **Bot Gateway:** ${client.user.tag}\n` +
           `> **Control Center:** ${opChText}\n` +
           `> **Target Vector:** ${targetChText}\n` +
           `> **Operational Status:** ${modeStatus}\n` +
           `> **Payload Queue:** \`${messageQueue.length}\` Data tertahan\n` +
           `━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

client.on('ready', async () => {
    console.log(`[SYS] Bot aktif sebagai ${client.user.tag}`);
    await registerCommands(client.user.id);
    setInterval(processQueue, 3000);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    if (commandName === 'setchoperator') {
        operatorChannelId = interaction.channelId;
        await interaction.reply({ 
            content: `**[ ⚙️ CONFIG ]** | Channel ini telah ditetapkan sebagai Pusat Kontrol Utama.`, 
            ephemeral: true 
        });
    }
    else if (commandName === 'settarget') {
        targetChannelId = interaction.options.getString('channel_id');
        isStandby = false; 
        await interaction.reply({ 
            content: `**[ 🎯 TARGET ]** | Kordinat tujuan berhasil dikunci ke: <#${targetChannelId}>.`, 
            ephemeral: true 
        });
    }
    else if (commandName === 'startkirim') {
        if (!operatorChannelId) return interaction.reply({ content: "**[ ⚠️ ALERT ]** Konfigurasi `/setchoperator` terlebih dahulu.", ephemeral: true });
        if (!targetChannelId) return interaction.reply({ content: "**[ ⚠️ ALERT ]** Tentukan rute menggunakan `/settarget` terlebih dahulu.", ephemeral: true });

        const msgId = interaction.options.getString('message_id');
        
        try {
            const targetMsg = await interaction.channel.messages.fetch(msgId);
            let finalContent = targetMsg.content || "";
            
            if (targetMsg.attachments.size > 0) {
                const attachmentUrls = targetMsg.attachments.map((a, index) => `[ 📎 Attachment Data ${index + 1} ](${a.url})`).join('\n');
                finalContent += `\n\n${attachmentUrls}`; 
            }

            if (!finalContent) return interaction.reply({ content: "**[ ⚠️ ALERT ]** Muatan pesan kosong. Operasi dibatalkan.", ephemeral: true });

            messageQueue.push(finalContent);
            await interaction.reply({ 
                content: `**[ 🚀 EKSEKUSI ]** | Muatan pesan diamankan. Memulai penetrasi ke target...`, 
                ephemeral: true 
            });
            processQueue();

        } catch (err) {
            await interaction.reply({ content: `**[ ❌ ERROR ]** Kordinat ID Pesan \`${msgId}\` tidak ditemukan.`, ephemeral: true });
        }
    }
    else if (commandName === 'status') {
        await interaction.deferReply({ ephemeral: true });
        const statusMsg = await getStatusText();
        await interaction.editReply({ content: statusMsg });
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    if (message.content === '!status' || message.content === '.status') {
        const statusMsg = await getStatusText();
        return message.reply({ content: statusMsg });
    }

    if (message.content === '!startkirim' || message.content === '.startkirim') {
        if (!operatorChannelId) return message.reply("**[ ⚠️ ALERT ]** Konfigurasi `/setchoperator` terlebih dahulu.");
        if (!targetChannelId) return message.reply("**[ ⚠️ ALERT ]** Tentukan rute menggunakan `/settarget` terlebih dahulu.");

        if (!message.reference || !message.reference.messageId) {
            return message.reply("**[ ⚠️ ALERT ]** Balas (reply) muatan pesan yang ingin ditransmisikan.");
        }

        try {
            const targetMsg = await message.channel.messages.fetch(message.reference.messageId);
            let finalContent = targetMsg.content || "";
            
            if (targetMsg.attachments.size > 0) {
                const attachmentUrls = targetMsg.attachments.map((a, index) => `[ 📎 Attachment Data ${index + 1} ](${a.url})`).join('\n');
                finalContent += `\n\n${attachmentUrls}`; 
            }

            if (!finalContent) return message.reply("**[ ⚠️ ALERT ]** Muatan pesan kosong.");

            messageQueue.push(finalContent);
            message.reply("**[ 🚀 EKSEKUSI ]** | Muatan pesan diamankan. Memulai penetrasi ke target...");
            processQueue();

        } catch (err) {
            message.reply("**[ ❌ ERROR ]** Gagal mengamankan muatan dari pesan yang direply.");
        }
    }
});

client.login(BOT_TOKEN);
