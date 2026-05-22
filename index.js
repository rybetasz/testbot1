require('dotenv').config({ path: '/home/ubuntu/testbot1/.env' });
const { Client, GatewayIntentBits } = require('discord.js');
const { LavalinkManager } = require('lavalink-client');

// 1. Discord Client Kurulumu
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const PREFIX = "!";

// 2. Lavalink Yönetici Ayarları
const lavalink = new LavalinkManager({
    nodes: [{
        host: '127.0.0.1',
        port: 2333,
        authorization: 'youshallnotpass',
        secure: false
    }],
    sendToShard: (guildId, payload) => {
        const guild = client.guilds.cache.get(guildId);
        if (guild) guild.shard.send(payload);
    },
    client: {
        id: process.env.CLIENT_ID, // .env dosyana CLIENT_ID ekle veya ready olayında bekle
        username: 'MusicBot'
    }
});

// --- LAVALINK ETKİNLİKLERİ ---
lavalink.nodeManager.on('connect', node => console.log(`✅ [Lavalink] Sunucuya bağlandı!`));
lavalink.nodeManager.on('error', (node, error) => console.error(`❌ [Lavalink] Hatası:`, error));

lavalink.on('trackStart', (player, track) => {
    const channel = client.channels.cache.get(player.textChannelId);
    if (channel) channel.send(`🎵 Şu an çalıyor: **${track.info.title}**`);
});

// Şarkı bittiğinde otomatik sıradakine geçer (Bu kütüphanede otomatiktir)
lavalink.on('queueEnd', (player) => {
    const channel = client.channels.cache.get(player.textChannelId);
    if (channel) channel.send("✅ Sıradaki tüm şarkılar bitti.");
    // 3 dakika sonra kanaldan çıkma (AFK)
    setTimeout(() => {
        if (!player.playing && player.queue.tracks.length === 0) {
            player.destroy();
        }
    }, 180000);
});

// --- BOT HAZIR OLDUĞUNDA ---
client.on('ready', async () => {
    console.log(`✅ [Bot] ${client.user.tag} olarak giriş yapıldı!`);
    
    await lavalink.init({
        id: client.user.id,
        username: client.user.username
    });
});

// Ses verilerini iletme (Çalışması için kritik kısım)
client.on('raw', (d) => {
    if (['VOICE_STATE_UPDATE', 'VOICE_SERVER_UPDATE'].includes(d.t)) {
        lavalink.sendRawData(d);
    }
});

// --- KOMUTLAR ---
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const command = args.shift().toLowerCase();

    if (command === 'play' || command === 'p') {
        const query = args.join(' ');
        if (!query) return message.reply('❌ Şarkı adı veya link gir!');

        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) return message.reply('❌ Önce bir ses kanalına gir!');

        try {
            let player = lavalink.getPlayer(message.guild.id);
            
            if (!player) {
                player = await lavalink.createPlayer({
                    guildId: message.guild.id,
                    voiceChannelId: voiceChannel.id,
                    textChannelId: message.channel.id,
                    selfDeaf: true,
                    volume: 100
                });
                await player.connect();
            }

            // Arama yapma
            const result = await player.search({ query: query }, message.author.id);
            
            if (!result || !result.tracks || result.tracks.length === 0) {
                return message.reply('❌ Şarkı bulunamadı.');
            }

            if (result.loadType === 'playlist') {
                player.queue.add(result.tracks);
                message.reply(`🔍 **${result.playlist.name}** listesinden ${result.tracks.length} şarkı eklendi.`);
            } else {
                player.queue.add(result.tracks[0]);
                message.reply(`🔍 **${result.tracks[0].info.title}** sıraya eklendi.`);
            }

            // Eğer bir şey çalmıyorsa başlat
            if (!player.playing && !player.paused) await player.play();

        } catch (error) {
            console.error(error);
            message.reply('❌ Hata oluştu: ' + error.message);
        }
    }

    if (command === 'skip' || command === 's') {
        const player = lavalink.getPlayer(message.guild.id);
        if (!player) return;
        await player.skip();
        message.reply("⏭️ Şarkı geçildi.");
    }

    if (command === 'stop') {
        const player = lavalink.getPlayer(message.guild.id);
        if (player) {
            await player.destroy();
            message.reply("⛔ Durduruldu.");
        }
    }
});

client.login(process.env.TOKEN);
