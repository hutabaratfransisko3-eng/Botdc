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
                .setRequired(true))
].map(command => command.toJSON());

async function registerCommands(clientId) {
    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
        console.log('Slash Commands berhasil terdaftar!');
    } catch (error) {
        console.error('Gagal mendaftarkan Slash Commands:', error);
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
        return true;
    } catch (error) {
        console.error("ERROR KIRIM USER:", error.response ? JSON.stringify(error.response.data) : error.message);
        return false;
    }
}

async function processQueue() {
    if (messageQueue.length === 0 || !targetChannelId) return;

    const targetChannel = client.channels.cache.get(targetChannelId);
    
    if (!targetChannel) {
        if (operatorChannelId) {
            const opChannel = client.channels.cache.get(operatorChannelId);
            if (opChannel) opChannel.send(`❌ **Error:** Bot tidak bisa melihat channel target ID: \`${targetChannelId}\`. Cek izin bot!`);
        }
        return; 
    }

    const canSend = targetChannel.permissionsFor(targetChannel.guild.id).has('SendMessages');

    if (!canSend) {
        if (!isStandby) {
            isStandby = true;
            if (operatorChannelId) {
                const opChannel = client.channels.cache.get(operatorChannelId);
                if (opChannel) opChannel.send(`⚠️ **Mode Siaga Aktif:** Channel <#${targetChannelId}> masih dikunci. Pesan dimasukkan ke antrean.`);
            }
        }
        return; 
    }

    isStandby = false;
    let successCount = 0;

    while (messageQueue.length > 0) {
        const msgContent = messageQueue[0]; 
        const success = await sendAsUser(targetChannelId, msgContent);
        
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
