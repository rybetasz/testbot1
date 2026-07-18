require('dotenv').config();

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

/* ---------------- LAVALINK ---------------- */

const lavalink = new LavalinkManager({
    nodes: [
        {
            id: "main",
            host: '127.0.0.1',
            port: 2333,
            authorization: 'youshallnotpass',
            secure: false,
            retryAmount: 10,
            retryDelay: 5000,
        }
    ],

    sendToShard: (guildId, payload) => {
        const guild = client.guilds.cache.get(guildId);
        if (guild) guild.shard.send(payload);
    },

    client: {
        id: "",
        username: 'MusicBot'
    },

    playerOptions: {
        onDisconnectFinish: true,
        onStopFinish: true,
        defaultSearchPlatform: "youtube",
        volumeDecrementer: 1
    }
});

/* ---------------- LAVALINK EVENTS ---------------- */

lavalink.nodeManager.on('connect', node => {
    console.log(`✅ Lavalink bağlandı: ${node.id}`);
});

lavalink.nodeManager.on('error', (node, error) => {
    console.error(`❌ Lavalink hata (${node.id}):`, error);
});

lavalink.on('trackStart', async (player, track) => {
    const channel = client.channels.cache.get(player.textChannelId);

    if (channel) {
        channel.send(`🎵 Şu an çalıyor: **${track.info.title}**`);
    }
});

/* Gerçek çalma hatalarını gösteren event'ler */

lavalink.on('trackException', async (player, track, payload) => {
    console.error('[TRACK EXCEPTION]', JSON.stringify(payload, null, 2));

    const channel = client.channels.cache.get(player.textChannelId);
    if (channel) {
        channel.send(`⚠️ Çalma hatası: \`${payload?.exception?.message || 'bilinmeyen hata'}\``);
    }
});

lavalink.on('trackStuck', async (player, track, payload) => {
    console.error('[TRACK STUCK]', JSON.stringify(payload, null, 2));

    const channel = client.channels.cache.get(player.textChannelId);
    if (channel) {
        channel.send(`⚠️ Şarkı takıldı, geçiliyor: **${track?.info?.title}**`);
    }
});

lavalink.on('trackEnd', async (player, track, payload) => {
    console.log('[TRACK END] reason:', payload?.reason, '| title:', track?.info?.title);
});

lavalink.on('queueEnd', async (player) => {
    const channel = client.channels.cache.get(player.textChannelId);

    if (channel) {
        channel.send("✅ Kuyruk bitti. 3 dakika sonra çıkılacak.");
    }

    setTimeout(async () => {
        const currentPlayer = lavalink.getPlayer(player.guildId);

        if (
            currentPlayer &&
            !currentPlayer.playing &&
            currentPlayer.queue.tracks.length === 0
        ) {
            await currentPlayer.destroy();

            if (channel) {
                channel.send("👋 Ses kanalından çıkıldı.");
            }
        }
    }, 180000);
});

/* ---------------- DISCORD EVENTS ---------------- */

client.on('ready', async () => {
    console.log(`✅ Bot aktif: ${client.user.tag}`);

    await lavalink.init({
        id: client.user.id,
        username: client.user.username
    });
});

/* VOICE EVENTS */

client.on('raw', (d) => {
    if (
        d.t === 'VOICE_STATE_UPDATE' ||
        d.t === 'VOICE_SERVER_UPDATE'
    ) {
        lavalink.sendRawData(d);
    }
});

/* ---------------- COMMANDS ---------------- */

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content
        .slice(PREFIX.length)
        .trim()
        .split(/\s+/);

    const command = args.shift().toLowerCase();

    /* ---------------- PLAY ---------------- */

    if (command === "play" || command === "p") {

        const query = args.join(" ");

        if (!query) {
            return message.reply("❌ Şarkı adı veya link gir.");
        }

        const voiceChannel = message.member.voice.channel;

        if (!voiceChannel) {
            return message.reply("❌ Önce ses kanalına gir.");
        }

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

            /* URL KONTROL */

            const isUrl = /^https?:\/\//.test(query);

            let result;

            if (isUrl) {

                console.log("[LOG] Link çözülüyor...");

                result = await player.search(
                    query,
                    message.author.id
                );

            } else {

                console.log("[LOG] YouTube araması yapılıyor...");

                result = await player.search(
                    `ytsearch:${query}`,
                    message.author.id
                );
            }

            /* SONUÇ YOKSA / HATA VARSA */

            if (
                !result ||
                !result.tracks ||
                result.tracks.length === 0
            ) {
                console.log("[DEBUG] loadType:", result?.loadType);
                console.log("[DEBUG] exception:", result?.exception);
                console.log("[DEBUG] full result:", JSON.stringify(result, null, 2));

                return message.reply(
                    `❌ Sonuç bulunamadı.\nloadType: \`${result?.loadType}\`\n${result?.exception?.message ? `Hata: \`${result.exception.message}\`` : ""}`
                );
            }

            /* PLAYLIST */

            if (result.loadType === "playlist") {

                player.queue.add(result.tracks);

                await message.reply(
                    `✅ Playlist eklendi: **${result.playlist.name}** (${result.tracks.length} şarkı)`
                );

            } else {

                const track = result.tracks[0];

                player.queue.add(track);

                await message.reply(
                    `➕ Kuyruğa eklendi: **${track.info.title}**`
                );
            }

            /* PLAY */

            if (!player.playing && !player.paused) {
                await player.play();
            }

        } catch (err) {

            console.error(err);

            message.reply(
                `❌ Hata oluştu:\n\`${err.message}\``
            );
        }
    }

    /* ---------------- SEARCH (YouTube seçimli arama) ---------------- */

    if (command === "search" || command === "ara") {

        const query = args.join(" ");

        if (!query) {
            return message.reply("❌ Aranacak şarkı adı gir. Örnek: `!search despacito`");
        }

        const voiceChannel = message.member.voice.channel;

        if (!voiceChannel) {
            return message.reply("❌ Önce ses kanalına gir.");
        }

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

            console.log("[LOG] YouTube arama (seçimli) yapılıyor...");

            const result = await player.search(
                `ytsearch:${query}`,
                message.author.id
            );

            if (!result || !result.tracks || result.tracks.length === 0) {
                return message.reply("❌ Sonuç bulunamadı.");
            }

            const options = result.tracks.slice(0, 5);

            const listText = options
                .map((t, i) => `**${i + 1}.** ${t.info.title} (${t.info.author})`)
                .join("\n");

            await message.reply(
                `🔎 Arama sonuçları:\n${listText}\n\n👉 30 saniye içinde **1-${options.length}** arası bir sayı yaz.`
            );

            const filter = (m) =>
                m.author.id === message.author.id &&
                /^[1-5]$/.test(m.content.trim()) &&
                Number(m.content.trim()) <= options.length;

            const collected = await message.channel
                .awaitMessages({
                    filter,
                    max: 1,
                    time: 30000,
                    errors: ['time']
                })
                .catch(() => null);

            if (!collected || collected.size === 0) {
                return message.reply("⏱️ Süre doldu, arama iptal edildi.");
            }

            const chosenIndex = Number(collected.first().content.trim()) - 1;
            const track = options[chosenIndex];

            player.queue.add(track);

            await message.reply(`➕ Kuyruğa eklendi: **${track.info.title}**`);

            if (!player.playing && !player.paused) {
                await player.play();
            }

        } catch (err) {

            console.error(err);

            message.reply(
                `❌ Hata oluştu:\n\`${err.message}\``
            );
        }
    }

    /* ---------------- SKIP ---------------- */

    if (command === "skip" || command === "s") {

        const player = lavalink.getPlayer(message.guild.id);

        if (!player) {
            return message.reply("❌ Aktif player yok.");
        }

        await player.skip();

        message.reply("⏭️ Şarkı geçildi.");
    }

    /* ---------------- STOP ---------------- */

    if (command === "stop") {

        const player = lavalink.getPlayer(message.guild.id);

        if (!player) {
            return message.reply("❌ Aktif player yok.");
        }

        await player.destroy();

        message.reply("⛔ Müzik durduruldu.");
    }

    /* ---------------- QUEUE ---------------- */

    if (command === "queue" || command === "q") {

        const player = lavalink.getPlayer(message.guild.id);

        if (!player || player.queue.tracks.length === 0) {
            return message.reply("❌ Kuyruk boş.");
        }

        const queue = player.queue.tracks
            .slice(0, 10)
            .map((t, i) => `${i + 1}. ${t.info.title}`)
            .join("\n");

        message.reply(`📜 Kuyruk:\n${queue}`);
    }

});

/* ---------------- LOGIN ---------------- */

client.login(process.env.TOKEN);
