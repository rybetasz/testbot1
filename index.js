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

// Milisaniyeyi "Dakika:Saniye" veya "Saat:Dakika:Saniye" formatına çevirir
function formatTime(ms, isStream) {
    if (isStream) return "🔴 Canlı Yayın";
    if (ms >= 3600000) { // 1 saatten uzunsa
        return new Date(ms).toISOString().slice(11, 19);
    }
    return new Date(ms).toISOString().slice(14, 19);
}

/* ---------------- LAVALINK NODES & SHOUKAKU ---------------- */

const Nodes = [
    {
        name: "Ana-Sunucu",
        url: "127.0.0.1:2333", // application.yml'deki port
        auth: "youshallnotpass", // application.yml'deki şifre
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

    // Kuyrukta şarkı yoksa 3 dakikalık AFK sayacı başlat
    if (data.tracks.length === 0) {
        if (data.timeout) clearTimeout(data.timeout);
        
        data.timeout = setTimeout(() => {
            if (data.player) data.player.destroy();
            queue.delete(guildId);
            console.log(`[${guildId}] Bot boşta kaldığı için kanaldan ayrıldı.`);
        }, 180000); // 3 Dakika (180.000 ms)
        
        return;
    }

    // Yeni şarkı çalacağı için AFK sayacını iptal et
    if (data.timeout) {
        clearTimeout(data.timeout);
        data.timeout = null;
    }

    const nextTrack = data.tracks.shift();
    try {
        await data.player.playTrack({ track: { encoded: nextTrack.encoded } });
    } catch (err) {
        console.error(`[${guildId}] Oynatma hatası:`, err);
        playNext(guildId); // Hata verirse sıradakine geçmeye çalış
    }
}

/* ---------------- EVENTS ---------------- */

client.once("ready", () => console.log(`✅ Bot Aktif: ${client.user.tag}`));
client.shoukaku.on("ready", (name) => console.log(`✅ Lavalink Bağlandı: ${name}`));
client.shoukaku.on("error", (name, error) => console.error(`❌ Lavalink Hatası (${name}):`, error));

/* ---------------- COMMANDS ---------------- */

client.on("messageCreate", async (message) => {
    if (!message.guild || message.author.bot || !message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();
    const guildId = message.guild.id;

    /* --- PLAY COMMAND --- */
    if (cmd === "play" || cmd === "p") {
        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) return message.reply("❌ Önce bir ses kanalına girmelisin.");

        const query = args.join(" ");
        if (!query) return message.reply("❌ Bir şarkı adı veya link girmelisin.");

        let data = queue.get(guildId);

        // Player yoksa oluştur ve ses kanalına bağlan
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
                
                player.on("error", (err) => console.error("Player Hatası:", err));
                
                player.on("closed", () => {
                    if (data.timeout) clearTimeout(data.timeout);
                    queue.delete(guildId);
                });

            } catch (err) {
                console.error("Bağlantı Hatası:", err);
                return message.reply("❌ Ses kanalına bağlanırken hata oluştu.");
            }
        } else {
            // Bot kanaldaysa ve müzik ekleniyorsa, olası bir AFK sayacını iptal et
            if (data.timeout) {
                clearTimeout(data.timeout);
                data.timeout = null;
            }
        }

        try {
            // URL kontrolü
            const isUrl = /^https?:\/\//.test(query);
            const searchResult = await data.player.node.rest.resolve(isUrl ? query : `ytsearch:${query}`);

            if (!searchResult || searchResult.loadType === "empty" || searchResult.loadType === "error") {
                return message.reply("❌ Hiçbir sonuç bulunamadı.");
            }

            let tracks = [];
            if (searchResult.loadType === "playlist") {
                tracks = searchResult.data.tracks;
                message.reply(`✅ **${searchResult.data.info.name}** listesinden **${tracks.length}** şarkı eklendi.`);
            } else if (searchResult.loadType === "search" || searchResult.loadType === "track") {
                const track = Array.isArray(searchResult.data) ? searchResult.data[0] : searchResult.data;
                tracks.push(track);
            }

            if (tracks.length === 0) return message.reply("❌ Şarkı yüklenemedi.");

            // Şarkıyı çal veya sıraya ekle
            if (!data.player.track) {
                const first = tracks.shift();
                data.tracks.push(...tracks);
                
                await data.player.playTrack({ track: { encoded: first.encoded } });
                
                const timeStr = formatTime(first.info.length, first.info.isStream);
                message.reply(`🎵 Şu an çalıyor: **${first.info.title}** - *${first.info.author}* [\`${timeStr}\`]`);
            } else {
                data.tracks.push(...tracks);
                if (tracks.length === 1) {
                    const timeStr = formatTime(tracks[0].info.length, tracks[0].info.isStream);
                    message.reply(`➕ Sıraya eklendi: **${tracks[0].info.title}** - *${tracks[0].info.author}* [\`${timeStr}\`]`);
                }
            }

        } catch (searchErr) {
            console.error("Arama Hatası:", searchErr);
            message.reply("❌ Arama sırasında bir hata oluştu.");
        }
    }

    /* --- SKIP COMMAND --- */
    if (cmd === "skip" || cmd === "s") {
        const data = queue.get(guildId);
        if (!data || !data.player || !data.player.track) {
            return message.reply("❌ Şu anda çalan bir şarkı yok.");
        }
        data.player.stopTrack(); 
        message.reply("⏭️ Şarkı geçildi.");
    }

    /* --- STOP COMMAND --- */
    if (cmd === "stop") {
        const data = queue.get(guildId);
        if (data) {
            if (data.timeout) clearTimeout(data.timeout); // Sayaç varsa kapat
            data.tracks = []; // Kuyruğu temizle
            data.player.destroy(); // Bağlantıyı kopar
            queue.delete(guildId);
            message.reply("⛔ Müzik durduruldu ve kanaldan çıkıldı.");
        } else {
            message.reply("❌ Zaten bir ses kanalında değilim.");
        }
    }
});

/* ---------------- GLOBAL ERROR HANDLING ---------------- */

process.on("unhandledRejection", (error) => {
    console.error("--- GLOBAL HATA YAKALANDI ---");
    console.error(error);
    console.error("-----------------------------");
});

client.login(process.env.TOKEN);
