require('dotenv').config({ path: '/home/ubuntu/testbot1/.env' });
const { Client, GatewayIntentBits } = require("discord.js");
const { Shoukaku, Connectors } = require("shoukaku");

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

const Nodes = [{ name: "Ana-Sunucu", url: "127.0.0.1:2333", auth: "youshallnotpass", secure: false }];
client.shoukaku = new Shoukaku(new Connectors.DiscordJS(client), Nodes, { resume: true });

const queue = new Map();

/* ---------------- OYNATMA MANTIĞI ---------------- */

async function playNext(guildId) {
    const data = queue.get(guildId);
    if (!data) return;

    if (data.tracks.length === 0) {
        if (data.timeout) clearTimeout(data.timeout);
        data.timeout = setTimeout(() => {
            if (data.player) data.player.destroy();
            queue.delete(guildId);
            console.log(`[${guildId}] Boşta kalındığı için kanaldan çıkıldı.`);
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
        playNext(guildId); // Hata olursa sonrakine geç
    }
}

/* ---------------- KOMUTLAR ---------------- */

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
                    // Şarkı bittiğinde playNext çağır
                    if (reason.reason === "finished" || reason.reason === "stopped") {
                        playNext(guildId);
                    }
                });
                player.on("closed", () => queue.delete(guildId));
            } catch (err) {
                return message.reply("❌ Kanala bağlanılamadı.");
            }
        }

        try {
            const isUrl = /^https?:\/\//.test(query);
            let result;

            // 1. AŞAMA: Normal Arama / Link Çözme
            result = await data.player.node.rest.resolve(isUrl ? query : `ytsearch:${query}`);

            // 2. AŞAMA (KRİTİK): Eğer YouTube engellendiyse (empty), SoundCloud'da ara!
            if (!result || result.loadType === "empty" || result.loadType === "error") {
                if (!isUrl) {
                    console.log(`[LOG] YouTube engellendi, SoundCloud deneniyor: ${query}`);
                    result = await data.player.node.rest.resolve(`scsearch:${query}`);
                }
            }

            if (!result || result.loadType === "empty" || result.loadType === "error") {
                return message.reply("❌ Maalesef sonuç bulunamadı. YouTube botu engellemiş olabilir.");
            }

            let newTracks = [];
            if (result.loadType === "playlist") {
                newTracks = result.data.tracks;
                message.reply(`✅ Playlist eklendi: **${newTracks.length}** şarkı.`);
            } else {
                const track = Array.isArray(result.data) ? result.data[0] : result.data;
                newTracks.push(track);
            }

            if (data.timeout) {
                clearTimeout(data.timeout);
                data.timeout = null;
            }

            // ÇALMA KONTROLÜ
            if (!data.player.track) {
                const first = newTracks.shift();
                data.tracks.push(...newTracks);
                await data.player.playTrack({ track: { encoded: first.encoded } });
                message.reply(`🎵 Çalıyor: **${first.info.title}** [\`${formatTime(first.info.length, first.info.isStream)}\`]`);
            } else {
                data.tracks.push(...newTracks);
                message.reply(`➕ Kuyruğa eklendi: **${newTracks[0]?.info.title || "Şarkı"}**`);
            }

        } catch (error) {
            console.error(error);
            message.reply("❌ Arama sırasında bir hata oluştu.");
        }
    }

    if (cmd === "skip" || cmd === "s") {
        const data = queue.get(guildId);
        if (data?.player?.track) {
            data.player.stopTrack();
            message.reply("⏭️ Şarkı geçildi.");
        }
    }

    if (cmd === "stop") {
        const data = queue.get(guildId);
        if (data) {
            data.tracks = [];
            data.player.destroy();
            queue.delete(guildId);
            message.reply("⛔ Durduruldu.");
        }
    }
});

client.login(process.env.TOKEN);
