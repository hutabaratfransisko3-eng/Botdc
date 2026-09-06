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
        .setDescription('Meneruskan pesan yang di-reply ke channel target')
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
        console.error("Gagal mengirim sebagai user:", error.response ? error.response.data : error.message);
        return false;
    }
}

async function processQueue() {
    if (messageQueue.length === 0 || !targetChannelId) return;

    const targetChannel = client.channels.cache.get(targetChannelId);
    
    if (!targetChannel) {
        if (operatorChannelId) {
            const opChannel = client.channels.cache.get(operatorChannelId);
            if (opChannel) opChannel.send(`❌ **Error Kritis:** Bot pengelola tidak bisa melihat channel target <#${targetChannelId}>. Pastikan Bot sudah diundang ke server target dan memiliki izin View Channel!`);
        }
        return; 
    }

    const canSend = targetChannel.permissionsFor(targetChannel.guild.id).has('SendMessages');

    if (!canSend) {
        if (!isStandby) {
            isStandby = true;
            if (operatorChannelId) {
                const opChannel = client.channels.cache.get(operatorChannelId);
                if (opChannel) opChannel.send(`⚠️ **Mode Siaga Aktif:** Chanel <#${targetChannelId}> masih terkunci. Pesan ditahan di antrean.`);
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
                if (opChannel) opChannel.send(`❌ **Gagal:** Token User ditolak oleh Discord API. Cek log Railway Anda.`);
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
    setInterval(processQueue, 5000);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    if (commandName === 'setchoperator') {
        operatorChannelId = interaction.channelId;
        await interaction.reply(`✅ Chanel ini telah diatur sebagai **Chanel Operator**.`);
    }

    else if (commandName === 'settarget') {
        const chId = interaction.options.getString('channel_id');
        targetChannelId = chId;
        await interaction.reply(`✅ Chanel target pengiriman diatur ke: <#${targetChannelId}>`);
    }

    else if (commandName === 'startkirim') {
        if (!operatorChannelId) return interaction.reply({ content: "❌ Setel Chanel Operator terlebih dahulu dengan `/setchoperator`", ephemeral: true });
        if (!targetChannelId) return interaction.reply({ content: "❌ Setel Chanel Target terlebih dahulu dengan `/settarget`", ephemeral: true });

        const channel = interaction.channel;
        const messages = await channel.messages.fetch({ limit: 2 });
        const lastMsg = messages.first(); 
        
        let targetMsg = null;
        if (interaction.message?.reference) {
            targetMsg = await channel.messages.fetch(interaction.message.reference.messageId);
        } else {
            const fetched = await channel.messages.fetch(lastMsg.id);
            if (fetched.reference) {
                targetMsg = await channel.messages.fetch(fetched.reference.messageId);
            }
        }

        if (!targetMsg) return interaction.reply({ content: "❌ Anda harus mereply/balas pesan yang ingin dikirim lalu jalankan `/startkirim`.", ephemeral: true });

        let finalContent = targetMsg.content || "";
        if (targetMsg.attachments.size > 0) {
            const attachmentUrls = targetMsg.attachments.map(a => a.url).join('\n');
            finalContent += `\n${attachmentUrls}`; 
        }

        if (!finalContent) return interaction.reply({ content: "❌ Pesan kosong.", ephemeral: true });

        messageQueue.push(finalContent);
        await interaction.reply("⏳ Pesan dimasukkan ke sistem. Sedang mengecek status channel...");
        await processQueue();
    }
});

client.on('channelUpdate', (oldChannel, newChannel) => {
    if (newChannel.id === targetChannelId) {
        processQueue(); 
    }
});

client.login(BOT_TOKEN);            successCount++;
        } else {
            // Jika gagal karena API Error, hentikan loop agar tidak terhapus dari antrean
            if (operatorChannelId) {
                const opChannel = client.channels.cache.get(operatorChannelId);
                if (opChannel) opChannel.send(`❌ **Gagal:** Token User ditolak oleh Discord API. Cek log Railway Anda.`);
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
    setInterval(processQueue, 5000);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    if (commandName === 'setchoperator') {
        operatorChannelId = interaction.channelId;
        await interaction.reply(`✅ Chanel ini telah diatur sebagai **Chanel Operator**.`);
    }

    else if (commandName === 'settarget') {
        const chId = interaction.options.getString('channel_id');
        targetChannelId = chId;
        await interaction.reply(`✅ Chanel target pengiriman diatur ke: <#${targetChannelId}>`);
    }

    else if (commandName === 'startkirim') {
        if (!operatorChannelId) return interaction.reply({ content: "❌ Setel Chanel Operator terlebih dahulu dengan `/setchoperator`", ephemeral: true });
        if (!targetChannelId) return interaction.reply({ content: "❌ Setel Chanel Target terlebih dahulu dengan `/settarget`", ephemeral: true });

        const channel = interaction.channel;
        const messages = await channel.messages.fetch({ limit: 2 });
        const lastMsg = messages.first(); 
        
        let targetMsg = null;
        if (interaction.message?.reference) {
            targetMsg = await channel.messages.fetch(interaction.message.reference.messageId);
        } else {
            const fetched = await channel.messages.fetch(lastMsg.id);
            if (fetched.reference) {
                targetMsg = await channel.messages.fetch(fetched.reference.messageId);
            }
        }

        if (!targetMsg) return interaction.reply({ content: "❌ Anda harus mereply/balas pesan yang ingin dikirim lalu jalankan `/startkirim`.", ephemeral: true });

        let finalContent = targetMsg.content || "";
        if (targetMsg.attachments.size > 0) {
            const attachmentUrls = targetMsg.attachments.map(a => a.url).join('\n');
            finalContent += `\n${attachmentUrls}`; 
        }

        if (!finalContent) return interaction.reply({ content: "❌ Pesan kosong.", ephemeral: true });

        messageQueue.push(finalContent);
        await interaction.reply("⏳ Pesan dimasukkan ke sistem. Sedang mengecek status channel...");
        await processQueue();
    }
});

client.on('channelUpdate', (oldChannel, newChannel) => {
    if (newChannel.id === targetChannelId) {
        processQueue(); 
    }
});

client.login(BOT_TOKEN);    }

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
