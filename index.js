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
        .setName('status')
        .setDescription('Tampilkan laporan diagnostik sistem'),
    new SlashCommandBuilder()
        .setName('startkirimcs')
        .setDescription('Isi formulir CS dan upload hingga 5 foto (Native Upload)')
        .addStringOption(opt => opt.setName('nama_ic').setDescription('Isi Nama [IC]').setRequired(true))
        .addStringOption(opt => opt.setName('umur_ic').setDescription('Isi Umur [IC]').setRequired(true))
        .addStringOption(opt => opt.setName('tgl_lahir').setDescription('Isi Tanggal lahir [IC sesuai Id card]').setRequired(true))
        .addStringOption(opt => opt.setName('story').setDescription('Link Pastebin / Teks Story').setRequired(true))
        .addAttachmentOption(opt => opt.setName('foto_1').setDescription('Upload Foto 1 (Wajib)').setRequired(true))
        .addAttachmentOption(opt => opt.setName('foto_2').setDescription('Upload Foto 2 (Opsional)').setRequired(false))
        .addAttachmentOption(opt => opt.setName('foto_3').setDescription('Upload Foto 3 (Opsional)').setRequired(false))
        .addAttachmentOption(opt => opt.setName('foto_4').setDescription('Upload Foto 4 (Opsional)').setRequired(false))
        .addAttachmentOption(opt => opt.setName('foto_5').setDescription('Upload Foto 5 (Opsional)').setRequired(false))
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

// Menggunakan Native Fetch & FormData Node.js untuk bypass limit & upload langsung
async function sendAsUser(channelId, msgData) {
    try {
        const formData = new FormData();
        formData.append('payload_json', JSON.stringify({ content: msgData.content }));

        // Download gambar dari link bot dan masukkan ke form data secara gaib
        if (msgData.attachments && msgData.attachments.length > 0) {
            for (let i = 0; i < msgData.attachments.length; i++) {
                const fileRes = await fetch(msgData.attachments[i].url);
                const blob = await fileRes.blob();
                formData.append(`files[${i}]`, blob, msgData.attachments[i].name);
            }
        }

        const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
            method: 'POST',
            headers: { 
                'Authorization': USER_TOKEN, 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            body: formData
        });

        if (!res.ok) {
            const errorData = await res.json();
            return { success: false, status: res.status, code: errorData.code, data: errorData };
        }
        
        return { success: true };
    } catch (error) {
        return { success: false, data: error.message };
    }
}

async function processQueue() {
    if (messageQueue.length === 0 || !targetChannelId) return;

    const msgData = messageQueue[0]; 
    const result = await sendAsUser(targetChannelId, msgData);
    
    if (result.success) {
        messageQueue.shift(); 
        isStandby = false;
        
        if (operatorChannelId) {
            const opChannel = client.channels.cache.get(operatorChannelId);
            if (opChannel) opChannel.send(`**[ 🟢 UPLINK SUCCESS ]** | Transmisi data CS ke target berhasil dieksekusi (Beserta unggahan foto).`);
        }
    } else {
        if (result.status === 403 || result.code === 50013 || result.code === 50001 || result.code === 50009) {
            if (!isStandby) {
                isStandby = true;
                if (operatorChannelId) {
                    const opChannel = client.channels.cache.get(operatorChannelId);
                    if (opChannel) opChannel.send(`**[ 🟡 SYSTEM STANDBY ]** | Akses ke <#${targetChannelId}> terkunci. Protokol pemantauan pasif diaktifkan.`);
                }
            }
        } 
        else if (result.status === 401) {
            if (operatorChannelId && !isStandby) {
                const opChannel = client.channels.cache.get(operatorChannelId);
                if (opChannel) opChannel.send(`**[ 🔴 CRITICAL ERROR ]** | Autentikasi ditolak (401). User Token kedaluwarsa.`);
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

    let queuePreview = `\`0\` Data tertahan`;
    if (messageQueue.length > 0) {
        queuePreview = `\`${messageQueue.length}\` Data tertahan dalam antrean`;
    }

    return `\`\`\`ini\n[ SYSTEM DIAGNOSTIC REPORT ]\n\`\`\`` +
           `> **User Node:** ${accountStatus}\n` +
           `> **Bot Gateway:** ${client.user.tag}\n` +
           `> **Control Center:** ${opChText}\n` +
           `> **Target Vector:** ${targetChText}\n` +
           `> **Operational Status:** ${modeStatus}\n` +
           `> **Payload Queue:** ${queuePreview}\n` +
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
    else if (commandName === 'startkirimcs') {
        if (!operatorChannelId) return interaction.reply({ content: "**[ ⚠️ ALERT ]** Konfigurasi `/setchoperator` terlebih dahulu.", ephemeral: true });
        if (!targetChannelId) return interaction.reply({ content: "**[ ⚠️ ALERT ]** Tentukan rute menggunakan `/settarget` terlebih dahulu.", ephemeral: true });

        const namaIC = interaction.options.getString('nama_ic');
        const umurIC = interaction.options.getString('umur_ic');
        const tglLahir = interaction.options.getString('tgl_lahir');
        const story = interaction.options.getString('story');
        
        const rawAttachments = [
            interaction.options.getAttachment('foto_1'),
            interaction.options.getAttachment('foto_2'),
            interaction.options.getAttachment('foto_3'),
            interaction.options.getAttachment('foto_4'),
            interaction.options.getAttachment('foto_5')
        ];

        let validAttachments = [];
        for (const att of rawAttachments) {
            if (att) {
                validAttachments.push({ url: att.url, name: att.name });
            }
        }

        const finalContent = `Nama [IC] : ${namaIC}\nUmur [IC] : ${umurIC}\nTanggal lahir [IC sesuai Id card] : ${tglLahir}\nSs stats & Id card [Wajib] : ada\nSs Tab Level in Game [Wajib] : ada\nStory : ${story}\nTag : <@&1212085960418791464>`;

        messageQueue.push({ content: finalContent, attachments: validAttachments });
        
        await interaction.reply({ 
            content: `**[ 🚀 EKSEKUSI ]** | Formulir CS atas nama **${namaIC}** berserta **${validAttachments.length} foto** diamankan. Menginisiasi native upload...`, 
            ephemeral: true 
        });
        
        processQueue();
    }
    else if (commandName === 'status') {
        await interaction.deferReply({ ephemeral: true });
        const statusMsg = await getStatusText();
        await interaction.editReply({ content: statusMsg });
    }
});

client.login(BOT_TOKEN);
