require('dotenv').config({ path: '/home/ubuntu/testbot1/.env' });
const { Client, GatewayIntentBits } = require('discord.js');
const { LavalinkManager } = require('lavalink-client');

/* ---------------- DISCORD CLIENT ---------------- */
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const PREFIX = "!";

/* ---------------- LAVALINK MANAGER ---------------- */
const lavalink = new LavalinkManager({
    nodes: [{
        host: '127.0.0.1',
        port: 2333,
        authorization: 'youshallnotpass',
        secure: false,
        retryAmount: 10,
        retryDelay: 5000,
    }],
    sendToShard: (guildId, payload) => {
        const guild = client.guilds.cache.get(guildId);
        if (guild) guild.shard.send(payload);
    },
    client: {
        id: "", // Ready olayında dolacak
        username: 'MusicBot'
    },
    // Kuyruk Ayarları
    playerOptions: {
        onStopFinish: true, // Durunca kuyruğu temizle
        onDisconnectFinish: true, // Çıkınca kuyruğu temizle
        defaultSearchPlatform: "youtube", 
    }
});

/* ---------------- EVENTS ---------------- */

lavalink.nodeManager.on('connect', node => console.log(`✅ [Lavalink] ${node.id} bağlantısı başarılı!`));
lavalink.nodeManager.on('error', (node, error) => console.error(`❌ [Lavalink] Hata:`, error));

lavalink.on('trackStart', (player, track) => {
    const channel = client.channels.cache.get(player.textChannelId);
    if (channel) channel.send(`🎵 Şu an çalıyor: **${track.info.title}**`);
});

lavalink.on('queueEnd', (player) => {
    const channel = client.channels.cache.get(player.textChannelId);
    if (channel) channel.send("✅ Liste bitti. 3 dakika sonra kanaldan çıkılacak.");
    
    // 3 Dakikalık AFK Çıkış Sistemi
    setTimeout(() => {
        const currentPlayer = lavalink.getPlayer(player.guildId);
        if (currentPlayer && currentPlayer.queue.tracks.length === 0 && !currentPlayer.playing) {
            currentPlayer.destroy();
        }
    }, 180000);
});

client.on('ready', async () => {
    console.log(`✅ [Bot] ${client.user.tag} aktif!`);
    await lavalink.init({ id: client.user.id, username: client.user.username });
});

// SES PAKETLERİNİ İLETME (Olmazsa olmaz)
client.on('raw', d => {
    if (['VOICE_STATE_UPDATE', 'VOICE_SERVER_UPDATE'].includes(d.t)) {
        lavalink.sendRawData(d);
    }
});

/* ---------------- COMMANDS ---------------- */

client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const command = args.shift().toLowerCase();

    if (command === "play" || command === "p") {
        const query = args.join(" ");
        if (!query) return message.reply("❌ Bir isim veya link girmelisin.");

        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) return message.reply("❌ Önce bir ses kanalına gir.");

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

            // --- ARAMA VE LİNK ÇÖZME ---
            // 'youtube' üzerinden arıyoruz ama link ise direkt linki çözer
            let result = await player.search({ query: query }, message.author.id);

            // KRİTİK DÜZELTME: Link doğrudan bulunamazsa, onu YouTube aramasına zorla
            if (!result || !result.tracks || result.tracks.length === 0) {
                console.log("[LOG] Link bulunamadı, arama olarak deneniyor...");
                result = await player.search({ query: `ytsearch:${query}` }, message.author.id);
            }

            if (!result || !result.tracks || result.tracks.length === 0) {
                return message.reply("❌ Hiçbir sonuç bulunamadı.");
            }

            if (result.loadType === "playlist") {
                player.queue.add(result.tracks);
                message.reply(`✅ Playlist eklendi: **${result.playlist.name}** (${result.tracks.length} şarkı)`);
            } else {
                player.queue.add(result.tracks[0]);
                message.reply(`➕ Kuyruğa eklendi: **${result.tracks[0].info.title}**`);
            }

            // Oynatmıyorsa başlat
            if (!player.playing && !player.paused) await player.play();

        } catch (error) {
            console.error(error);
            message.reply("❌ Arama sırasında bir hata oluştu: " + error.message);
        }
    }

    if (command === "skip" || command === "s") {
        const player = lavalink.getPlayer(message.guild.id);
        if (player) {
            await player.skip();
            message.reply("⏭️ Şarkı geçildi.");
        }
    }

    if (command === "stop") {
        const player = lavalink.getPlayer(message.guild.id);
        if (player) {
            await player.destroy();
            message.reply("⛔ Müzik durduruldu.");
        }
    }
});

client.login(process.env.TOKEN);
