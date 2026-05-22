require('dotenv').config({ path: '/home/ubuntu/testbot1/.env' });
const { Client, GatewayIntentBits } = require("discord.js");
const { Shoukaku, Connectors } = require("shoukaku");

/* ---------------- DISCORD CLIENT SETUP ---------------- */

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

const prefix = "!";

/* ---------------- YARDIMCI FONKSİYONLAR ---------------- */

function formatTime(ms, isStream) {
    if (isStream) return "🔴 Canlı Yayın";
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

/* ---------------- LAVALINK NODES & SHOUKAKU ---------------- */

const Nodes = [
    {
        name: "Ana-Sunucu",
        url: "127.0.0.1:2333",
        auth: "youshallnotpass",
        secure: false,
    },
];

const shoukakuOptions = {
    resume: true,
    resumeTimeout: 60,
    reconnectTries: 10,
    restTimeout: 20000,
};

client.shoukaku = new Shoukaku(new Connectors.DiscordJS(client), Nodes, shoukakuOptions);

/* ---------------- QUEUE SYSTEM & AFK LOGIC ---------------- */

const queue = new Map();

async function playNext(guildId) {
    const data = queue.get(guildId);
    if (!data) return;

    if (data.tracks.length === 0) {
        if (data.timeout) clearTimeout(data.timeout);
        data.timeout = setTimeout(() => {
            if (data.player) data.player.destroy();
            queue.delete(guildId);
            console.log(`[${guildId}] Boşta kaldığı için ayrıldı.`);
        }, 180000); 
        return;
    }

    if (data.timeout) {
        clearTimeout(data.timeout);
        data.timeout = null;
    }

    const nextTrack = data.tracks.shift();
    try {
        await data.player.playTrack({ track: { encoded: nextTrack.encoded } });
    } catch (err) {
        console.error(`Oynatma hatası:`, err);
        playNext(guildId);
    }
}

/* ---------------- EVENTS ---------------- */

client.once("ready", () => console.log(`✅ Bot Aktif: ${client.user.tag}`));
client.shoukaku.on("ready", (name) => console.log(`✅ Lavalink Bağlandı: ${name}`));
client.shoukaku.on("error", (name, error) => console.error(`❌ Lavalink Hatası:`, error));

/* ---------------- COMMANDS ---------------- */

client.on("messageCreate", async (message) => {
    if (!message.guild || message.author.bot || !message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();
    const guildId = message.guild.id;

    if (cmd === "play" || cmd === "p") {
        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) return message.reply("❌ Bir ses kanalında olmalısın.");

        const query = args.join(" ");
        if (!query) return message.reply("❌ Şarkı adı veya link girmelisin.");

        let data = queue.get(guildId);

        if (!data) {
            try {
                const player = await client.shoukaku.joinVoiceChannel({
                    guildId: message.guild.id,
                    channelId: voiceChannel.id,
                    shardId: message.guild.shardId ?? 0,
                    deaf: true,
                });
                data = { player, tracks: [], timeout: null };
                queue.set(guildId, data);

                player.on("end", (reason) => {
                    if (reason.reason === "finished") playNext(guildId);
                });
                player.on("closed", () => {
                    if (data.timeout) clearTimeout(data.timeout);
                    queue.delete(guildId);
                });
            } catch (err) {
                return message.reply("❌ Kanala bağlanılamadı.");
            }
        }

        try {
            // URL kontrolü (Sadece http ile başlayanları link kabul et)
            const isUrl = /^https?:\/\//.test(query);
            const searchIdentifier = isUrl ? query : `ytsearch:${query}`;
            
            // Lavalink'e sorgu gönder
            const result = await data.player.node.rest.resolve(searchIdentifier);

            // LOG: Terminale bak, burada ne yazdığı çok önemli
            console.log(`Sorgu: ${searchIdentifier} | LoadType: ${result.loadType}`);

            if (!result || result.loadType === "empty" || result.loadType === "error") {
                return message.reply("❌ Sonuç bulunamadı. YouTube linki engellenmiş olabilir.");
            }

            let tracks = [];
            if (result.loadType === "playlist") {
                tracks = result.data.tracks;
                message.reply(`✅ **${result.data.info.name}** listesinden **${tracks.length}** şarkı eklendi.`);
            } else if (result.loadType === "search") {
                tracks.push(result.data[0]); // Arama sonucundaki ilk şarkı
            } else if (result.loadType === "track") {
                tracks.push(result.data); // Direkt linkten gelen şarkı
            }

            if (tracks.length === 0) return message.reply("❌ Şarkı verisi alınamadı.");

            if (!data.player.track) {
                const current = tracks.shift();
                data.tracks.push(...tracks);
                await data.player.playTrack({ track: { encoded: current.encoded } });
                message.reply(`🎵 Çalıyor: **${current.info.title}** - *${current.info.author}* [\`${formatTime(current.info.length, current.info.isStream)}\`]`);
            } else {
                data.tracks.push(...tracks);
                if (tracks.length === 1) {
                    message.reply(`➕ Sıraya eklendi: **${tracks[0].info.title}**`);
                }
            }
        } catch (error) {
            console.error(error);
            message.reply("❌ Arama sırasında teknik bir hata oluştu.");
        }
    }

    if (cmd === "skip" || cmd === "s") {
        const data = queue.get(guildId);
        if (data?.player) data.player.stopTrack();
        message.reply("⏭️ Şarkı geçildi.");
    }

    if (cmd === "stop") {
        const data = queue.get(guildId);
        if (data) {
            if (data.timeout) clearTimeout(data.timeout);
            data.player.destroy();
            queue.delete(guildId);
            message.reply("⛔ Durduruldu.");
        }
    }
});

client.login(process.env.TOKEN);
